/* eslint-disable camelcase */
/* eslint-disable prefer-promise-reject-errors */
const Sequelize = require('sequelize')
const Sentry = require('@sentry/node')
const { sequelize2: sequelize } = require('./../services/sqlConnect')
const { queuePop, redisClient } = require('./../services/memoryCache')
const { getFiveThirtyPlusDate } = require('./../api.response')

const doPointDistribution = async () => {
  try {
    let data = await queuePop('generateTeamPoints')

    if (!data) {
      setTimeout(() => { doPointDistribution() }, 5000)
      return
    }
    console.log('generateTeamPoints', data)
    data = JSON.parse(data)

    const all_players_obj = await getMatchPlayers(data.matchId)

    const all_team_players = await sequelize.query(
      'SELECT c.id AS user_team_player_id, c.user_team_id, c.player_id, d.player_key, c.match_id, c.captain, c.vice_captain, c.twelfth_man, c.points FROM user_team_players c JOIN players d ON c.player_id = d.id WHERE c.match_id = :match_id AND c.user_team_id=:team_id;',
      { raw: true, replacements: { match_id: data.matchId, team_id: data.teamId }, type: Sequelize.QueryTypes.SELECT }
    )

    const playingEleven = await getPlayingEleven(data.matchId)

    if (!playingEleven.length) {
      return // Playing eleven of the match is not set.
    }
    const current_date_time = getFiveThirtyPlusDate()

    let que2 = 'UPDATE user_team_players SET points = ( CASE id '
    let que3 = `  END ) , updated_at = '${current_date_time}' WHERE id IN ( `
    all_team_players.forEach(userPlayerObj => {
      let tp = 1
      if (!all_players_obj[userPlayerObj.player_id]) all_players_obj[userPlayerObj.player_id] = 0
      if (userPlayerObj.captain === '1') tp = 2
      if (userPlayerObj.vice_captain === '1') tp = 1.5
      userPlayerObj.points = all_players_obj[userPlayerObj.player_id] * tp

      que2 = `${que2} WHEN ${userPlayerObj.user_team_player_id} THEN ${userPlayerObj.points}`
      que3 = `${que3}${userPlayerObj.user_team_player_id} ,`
    })

    que3 = que3.substring(',', que3.length - 1)
    que3 = `${que3}  ) ;`
    que2 = que2 + que3

    const transaction = await sequelize.transaction()

    try {
      await sequelize.query(que2, { raw: true, type: Sequelize.QueryTypes.BULKUPDATE, transaction })
      await sequelize.query('UPDATE user_teams SET points_done=1 WHERE id=:id', { raw: true, replacements: { id: data.teamId }, type: Sequelize.QueryTypes.UPDATE, transaction })
      transaction.commit()
      doPointDistribution()
    } catch (error) {
      transaction.rollback()
      console.log(error)
      Sentry.captureMessage(error)
      doPointDistribution()
    }
  } catch (error) {
    console.log(error)
    Sentry.captureMessage(error)
    // doPointDistribution()
  }
}

const getMatchPlayers = async (match_id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const dataExists = await redisClient.get(`pd:mp:${match_id}`)
      if (dataExists) {
        resolve(JSON.parse(dataExists))
        return
      }

      const all_players = await sequelize.query(
        'SELECT players.id as player_id, match_players.match_id, players.player_key, scored_points AS player_points, players.player_name FROM match_players JOIN players ON players.id=match_players.player_id WHERE match_id=:match_id LIMIT 100;',
        { raw: true, replacements: { match_id }, type: Sequelize.QueryTypes.SELECT }
      )
      const all_players_obj = {}

      all_players.forEach(playerObj => {
        all_players_obj[playerObj.player_id] = playerObj.player_points || 0
      })
      await redisClient.set(`pd:mp:${match_id}`, JSON.stringify(all_players_obj), 'EX', 60)
      resolve(all_players_obj)
    } catch (error) {
      console.log(error)
      reject(error)
      // Sentry.captureMessage(error)
    }
  })
}


const getPlayingEleven = async (match_id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const dataExists = await redisClient.get(`pd:pe:${match_id}`)
      if (dataExists) {
        resolve(JSON.parse(dataExists))
        return
      }

      const all_players = await sequelize.query(
        "SELECT player_id FROM match_players WHERE match_id = :match_id AND `show` = '1' LIMIT 30 ;",
        { raw: true, replacements: { match_id }, type: Sequelize.QueryTypes.SELECT }
      )
      await redisClient.set(`pd:pe:${match_id}`, JSON.stringify(all_players), 'EX', 60)
      resolve(all_players)
    } catch (error) {
      console.log(error)
      reject(error)
      // Sentry.captureMessage(error)
    }
  })
}

setTimeout(() => {
  doPointDistribution()
}, 5000)

module.exports = {
  doPointDistribution
}
