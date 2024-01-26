/* eslint-disable eqeqeq */
/* eslint-disable camelcase */
const { Sequelize, Op } = require('sequelize')
const PlayerScores = require('./../models/playerscores.model')
const keys = require('../config/keys')
const { formatDate } = require('../config/helpers')
const { catchError, getFiveThirtyPlusDate, types, messages } = require('../api.response')
const axios = require('axios')
const fs = require('fs')
const Sentry = require('@sentry/node')
const {
  sequelize,
  models: {
    season_matches: SeasonMatchesModel,
    teams: TeamsModel,
    match_players: MatchPlayersModel,
    players: PlayersModel,
    player_roles: PlayerRolesModel
  }
} = require('../services/sqlConnect')

const schedule = async (req, res) => {
  try {
    const { match_dt, provider } = req.query
    const current_date_time = getFiveThirtyPlusDate()

    if (provider === 'entity_sport') {
      const sDate = new Date(match_dt)
      const eDate = new Date(new Date(match_dt).setDate(new Date(match_dt).getDate() + 1))

      const startDate = formatDate(sDate)
      const endDate = formatDate(eDate)

      const result = await getEntitySportSoccerData(startDate, endDate, req.userLanguage)
      return res.send({ type: result.type, message: result.message, data: result.data })
    } else {
      const response = await axios.get(`https://api.sportradar.us/soccer-x3/global/en/schedules/${match_dt}/schedule.json`, { params: { api_key: keys.footballApiKey } })
      const match_keys = []
      const data = response.data.sport_events
      data.map(s => match_keys.push(s.id.replace('sr:match:', '')))

      let matches = await SeasonMatchesModel.findAll({
        where: { match_key: match_keys, game_category: 'Football' },
        attributes: ['match_key'],
        raw: true
      })
      matches = matches.map(s => s.match_key)
      const teamKeysForImg = []

      data.forEach(s => {
        if (s.competitors[0].qualifier === 'home') {
          teamKeysForImg.push(s.competitors[0].id.replace('sr:competitor:', ''))
        } else if (s.competitors[1].qualifier === 'home') {
          teamKeysForImg.push(s.competitors[1].id.replace('sr:competitor:', ''))
        }
        if (s.competitors[1].qualifier === 'away') {
          teamKeysForImg.push(s.competitors[1].id.replace('sr:competitor:', ''))
        } else if (s.competitors[0].qualifier === 'away') {
          teamKeysForImg.push(s.competitors[0].id.replace('sr:competitor:', ''))
        }
      })

      const teamImages = await TeamsModel.findAll({
        where: { team_key: teamKeysForImg, game_category: 'Football', provider: 'sport_radar' },
        attributes: ['team_key', 'team_img'],
        group: 'team_key',
        raw: true
      })
      const newMatches = []
      const teams = []

      data.forEach(singleData => {
        let match_key = singleData.id
        match_key = match_key.replace('sr:match:', '')

        if (!matches.includes(match_key)) {
          let season_key = singleData.tournament.id
          season_key = season_key.replace('sr:tournament:', '')

          let gender = ''
          if (singleData.tournament.gender) {
            if (singleData.tournament.gender === 'women') {
              gender = '-Women'
            }
          }
          if ('season' in singleData && singleData.season.name.indexOf('Women') !== -1) {
            gender = '-Women'
          }

          let team_a_key
          let team_a_name
          let team_b_key
          let team_b_name
          if (singleData.competitors[0].qualifier === 'home') {
            team_a_key = singleData.competitors[0].id.replace('sr:competitor:', '')
            team_a_name = singleData.competitors[0].name.replace(/'/g, "\\'")
            team_a_name = team_a_name + gender
          } else if (singleData.competitors[1].qualifier === 'home') {
            team_a_key = singleData.competitors[1].id.replace('sr:competitor:', '')
            team_a_name = singleData.competitors[1].name.replace(/'/g, "\\'")
            team_a_name = team_a_name + gender
          }
          if (singleData.competitors[1].qualifier === 'away') {
            team_b_key = singleData.competitors[1].id.replace('sr:competitor:', '')
            team_b_name = singleData.competitors[1].name.replace(/'/g, "\\'")
            team_b_name = team_b_name + gender
          } else if (singleData.competitors[0].qualifier === 'away') {
            team_b_key = singleData.competitors[0].id.replace('sr:competitor:', '')
            team_b_name = singleData.competitors[0].name.replace(/'/g, "\\'")
            team_b_name = team_b_name + gender
          }

          let team_a_img = ''
          let team_b_img = ''

          if (teamImages.length) {
            for (let s = 0; s < teamImages.length; s++) {
              if (teamImages[s].team_key == team_a_key) {
                team_a_img = teamImages[s].team_img
                break
              }
            }
            for (let s = 0; s < teamImages.length; s++) {
              if (teamImages[s].team_key == team_b_key) {
                team_b_img = teamImages[s].team_img
                break
              }
            }
          }

          const checkAKey = obj => obj.team_key == team_a_key
          const checkBKey = obj => obj.team_key == team_b_key

          if ((!teamImages.some(checkAKey)) && (!teams.some(checkAKey))) {
            teams.push({ key: team_a_key, name: team_a_name })
          }

          if ((!teamImages.some(checkBKey)) && (!teams.some(checkBKey))) {
            teams.push({ key: team_b_key, name: team_b_name })
          }

          const dt = new Date(singleData.scheduled)
          if (keys.multiVersions === 'bangla') {
            dt.setHours(dt.getHours() + 6)
          } else {
            dt.setHours(dt.getHours() + 5)
            dt.setMinutes(dt.getMinutes() + 30)
          }

          const start_date = new Date(dt).toISOString().replace(/T/, ' ').replace(/\..+/, '')

          const short_name = singleData.competitors[0].abbreviation + ' vs ' + singleData.competitors[1].abbreviation
          let venue = '-'
          if (singleData.venue) {
            if (singleData.venue.name && singleData.venue.country_name) {
              venue = singleData.venue.name.replace(/[^a-zA-Z ]/g, '') + ' ' + singleData.venue.country_name.replace(/[^a-zA-Z ]/g, '')
            } else if (singleData.venue.name) {
              venue = singleData.venue.name.replace(/[^a-zA-Z ]/g, '')
            } else if (singleData.venue.country_name) {
              venue = singleData.venue.country_name.replace(/[^a-zA-Z ]/g, '')
            }
          }
          let tour_type = '-'
          if (singleData.tournament.type) {
            tour_type = singleData.tournament.type
          }
          let season_name = '-'
          if (singleData.season) {
            season_name = singleData.season.name.replace(/[^a-zA-Z ]/g, '')
          }

          newMatches.push({
            season_key,
            match_key,
            match_format: tour_type,
            short_name,
            season_name,
            venue,
            status: 'Pending',
            start_date,
            entry_close_time: start_date,
            season_team_a_key: team_a_key,
            season_team_b_key: team_b_key,
            season_team_a_name: team_a_name,
            season_team_b_name: team_b_name,
            season_team_a_img: team_a_img,
            season_team_b_img: team_b_img,
            game_category: 'Football',
            created_at: current_date_time,
            updated_at: current_date_time
          })
        } /* End If Statement */
      })

      const newTeams = []
      teams.forEach(singleTeam => {
        newTeams.push({
          team_key: singleTeam.key,
          team_name: singleTeam.name,
          game_category: 'Football',
          provider: 'sport_radar',
          created_at: current_date_time,
          updated_at: current_date_time
        })
      })

      if (newMatches && newMatches.length) {
        await SeasonMatchesModel.bulkCreate(newMatches)
      }
      if (newTeams && newTeams.length) {
        await TeamsModel.bulkCreate(newTeams)
      }
      return res.send({ type: types.success, message: messages[req.userLanguage].match_uploaded, data: {} })
    }
  } catch (error) {
    console.log(error)
    return catchError('footballapiController.schedule', error, req, res)
  }
}

const addPlayers = async (req, res) => {
  try {
    const { match_key } = req.query
    const match = await SeasonMatchesModel.findOne({
      where: { match_key, game_category: 'Football' },
      attributes: ['id', 'season_key', 'season_team_a_key', 'season_team_b_key', 'provider', 'match_key'],
      raw: true
    })

    if (match) {
      const teams = await TeamsModel.findAll({
        where: { team_key: [match.season_team_a_key, match.season_team_b_key], game_category: 'Football', provider: match.provider },
        raw: true,
        attributes: ['id', 'team_key'],
        group: 'team_key',
        limit: 2
      })

      const rolesTemp = await PlayerRolesModel.findAll({
        where: { game_category: 'Football' },
        attributes: ['id', 'name'],
        raw: true
      })
      let team_a_id = 0
      let team_b_id = 0

      teams.forEach(singleTeam => {
        if (singleTeam.team_key == match.season_team_a_key) {
          team_a_id = singleTeam.id
        } else if (singleTeam.team_key == match.season_team_b_key) {
          team_b_id = singleTeam.id
        }
      })

      if (match.provider === 'entity_sport') {
        axios.get(`https://soccer.entitysport.com/matches/${match.match_key}/fantasy`, { params: { token: keys.entitySportSoccerAPI } })
          .then(async (response) => {
            const { home = [], away = [] } = response.data.response.items.teams
            const matchInfo = response.data.response.items.match_info
            const teamAId = matchInfo.teams.home.tid
            const teamBId = matchInfo.teams.away.tid
            const homePlayerArr = []
            const awayPlayerArr = []

            const playerRole = {
              Defender: 'defender',
              Midfielder: 'midfielder',
              Forward: 'forward',
              Goalkeeper: 'goalkeeper'
            }

            if (home.length) {
              for (let j = 0; j < home.length; j++) {
                const obj = {
                  id: home[j].pid.toString(),
                  name: home[j].name,
                  type: playerRole[home[j].positionname],
                  nationality: home[j].nationality.name,
                  player_points: home[j].fantasy_player_rating || 0
                }
                if (teamAId === match.season_team_a_key) homePlayerArr.push(obj)
              }
            }

            if (away.length) {
              for (let j = 0; j < away.length; j++) {
                const obj = {
                  id: away[j].pid.toString(),
                  name: away[j].name,
                  type: playerRole[away[j].positionname],
                  nationality: away[j].nationality.name,
                  player_points: away[j].fantasy_player_rating || 0
                }
                if (teamBId === match.season_team_b_key) awayPlayerArr.push(obj)
              }
            }
            const homePlayerObj = { data: { players: homePlayerArr } }
            const awayPlayerObj = { data: { players: awayPlayerArr } }
            addPlayersLogic(homePlayerObj, match.id, rolesTemp, team_a_id, match.season_team_a_key, 'entity_sport')
            addPlayersLogic(awayPlayerObj, match.id, rolesTemp, team_b_id, match.season_team_b_key, 'entity_sport')
          }).catch((error) => {
            console.log('Error')
            console.log(error)
            console.log(error.response ? error.response.data : error)
            return res.send({ type: types.error, message: messages[req.userLanguage].err_occurred, data: error })
          })
      } else {
        /* Team A Players */
        axios.get(`https://api.sportradar.us/soccer-x3/global/en/teams/sr:competitor:${match.season_team_a_key}/profile.json`, { params: { api_key: keys.footballApiKey } })
          .then(function (response) {
            addPlayersLogic(response, match.id, rolesTemp, team_a_id, match.season_team_a_key, 'sport_radar')
          }).catch(function (error) {
            console.log(error)
            return res.send({ type: types.success, message: messages[req.userLanguage].err_occurred, data: { error } })
          })

        /* Team B Players */
        axios.get(`https://api.sportradar.us/soccer-x3/global/en/teams/sr:competitor:${match.season_team_b_key}/profile.json`, { params: { api_key: keys.footballApiKey } })
          .then(function (response) {
            addPlayersLogic(response, match.id, rolesTemp, team_b_id, match.season_team_b_key, 'sport_radar')
          }).catch(function (error) {
            console.log(error)
            return res.send({ type: types.success, message: messages[req.userLanguage].err_occurred, data: { error } })
          })
      }
      return res.send({ type: types.success, message: messages[req.userLanguage].player_uploaded, data: {} })
    } else {
      return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'Football match'), data: match })
    }
  } catch (error) {
    return catchError('footballapiController.addPlayers', error, req, res)
  }
}

const addPlayersLogic = async (response, matchID, rolesTemp, team_id, team_key, provider = 'sport_radar') => {
  try {
    if (response.data.players) {
      const data = response.data.players
      const players_temp = []
      const current_date_time = getFiveThirtyPlusDate()
      for (let m = 0; m < data.length; m++) {
        let player_key = data[m].id
        player_key = player_key.replace('sr:player:', '')
        players_temp.push(player_key)
      }

      const playersExist = await PlayersModel.findAll({
        where: { game_category: 'Football', player_key: players_temp, provider: provider },
        attributes: ['id', 'player_key', 'player_name', 'player_role_id', 'player_role', 'player_points'],
        raw: true
      })

      const que1 = []
      const que2 = []
      const actual_players = []

      if (playersExist.length) {
        const playersExistIDs = []
        for (let m = 0; m < playersExist.length; m++) {
          playersExistIDs.push(playersExist[m].id)
        }

        const matchPlayersExist = await MatchPlayersModel.findAll({
          where: { player_id: playersExistIDs, match_id: matchID },
          raw: true,
          attributes: ['id', 'match_id', 'player_id', 'team_id']
        })

        for (let m = 0; m < data.length; m++) {
          const role = data[m].type
          let role_name = 'GK'
          let role_id = 5

          if (role === 'goalkeeper') role_name = 'GK'
          else if (role === 'defender') role_name = 'DEF'
          else if (role === 'midfielder') role_name = 'MID'
          else if (role === 'forward') role_name = 'FWD'

          for (let j = 0; j < rolesTemp.length; j++) {
            if (role_name === rolesTemp[j].name) {
              role_id = rolesTemp[j].id
              break
            }
          }

          let player_name = data[m].name

          if (player_name.indexOf(', ') !== -1) {
            const temp_player_name = player_name.split(', ')
            player_name = temp_player_name[1].replace(/[^a-zA-Z ]/g, '') + ' ' + temp_player_name[0].replace(/[^a-zA-Z ]/g, '')
          }

          let player_key = data[m].id
          player_key = player_key.replace('sr:player:', '')

          const checkPlayerKey = obj => obj.player_key == player_key

          if (!playersExist.some(checkPlayerKey)) {
            que1.push({
              player_role: role_name,
              player_role_id: role_id,
              player_name: player_name,
              player_key: player_key,
              show: '0',
              game_category: 'Football',
              provider,
              teams: team_key,
              player_points: data[m].player_points || 0,
              created_at: current_date_time,
              updated_at: current_date_time
            })
            actual_players.push(player_key)
          }

          let player_id = 0
          let player_points = 0

          for (let i = 0; i < playersExist.length; i++) {
            if (player_key == playersExist[i].player_key) {
              player_id = playersExist[i].id
              player_points = playersExist[i].player_points
              break
            }
          }
          if (player_id !== 0) {
            const checkPlayerKey2 = obj => obj.player_id === player_id
            if (!(matchPlayersExist.length && matchPlayersExist.some(checkPlayerKey2))) {
              que2.push({
                match_id: matchID,
                player_id: player_id,
                team_id: team_id,
                show: '0',
                created_at: current_date_time,
                updated_at: current_date_time,
                player_points: player_points,
                player_role: role_name,
                player_role_id: role_id
              })
            }
          }
        } // end for loop

        if (que1 && que1.length) {
          await PlayersModel.bulkCreate(que1)
          const playersTemp16 = await PlayersModel.findAll({
            where: { game_category: 'Football', player_key: actual_players },
            attributes: ['id', 'player_key', 'player_role', 'player_role_id', 'player_points'],
            raw: true
          })

          const q16 = []
          for (let n = 0; n < playersTemp16.length; n++) {
            q16.push({
              match_id: matchID,
              player_id: playersTemp16[n].id,
              team_id: team_id,
              show: '0',
              created_at: current_date_time,
              updated_at: current_date_time,
              // player_points: 0,
              player_points: playersTemp16[n].player_points,
              player_role: playersTemp16[n].player_role,
              player_role_id: playersTemp16[n].player_role_id
            })
          }

          await MatchPlayersModel.bulkCreate(q16)
        } // end if que1
        if (que2 && que2.length) {
          await MatchPlayersModel.bulkCreate(que2)
        } // end if que2
      } else {
        for (let m = 0; m < data.length; m++) {
          const role = data[m].type
          let role_name = 'GK'
          let role_id = 5
          if (role === 'goalkeeper') role_name = 'GK'
          else if (role === 'defender') role_name = 'DEF'
          else if (role === 'midfielder') role_name = 'MID'
          else if (role === 'forward') role_name = 'FWD'

          for (let j = 0; j < rolesTemp.length; j++) {
            if (role_name === rolesTemp[j].name) {
              role_id = rolesTemp[j].id
              break
            }
          }

          for (let j = 0; j < rolesTemp.length; j++) {
            if (role_name === rolesTemp[j].name) {
              role_id = rolesTemp[j].id
              break
            }
          }

          let player_name = data[m].name
          if (player_name.indexOf(', ') !== -1) {
            const temp_player_name = player_name.split(', ')
            player_name = temp_player_name[1].replace(/[^a-zA-Z ]/g, '') + ' ' + temp_player_name[0].replace(/[^a-zA-Z ]/g, '')
          }

          let player_key = data[m].id
          player_key = player_key.replace('sr:player:', '')

          que1.push({
            player_role: role_name,
            player_role_id: role_id,
            player_name: player_name,
            player_key: player_key,
            show: '0',
            game_category: 'Football',
            teams: team_key,
            provider,
            player_points: data[m].player_points || 0,
            created_at: current_date_time,
            updated_at: current_date_time
          })

          actual_players.push(player_key)
        } // end for loop

        if (que1) {
          await PlayersModel.bulkCreate(que1)

          const playersTemp16 = await PlayersModel.findAll({
            where: { game_category: 'Football', player_key: actual_players },
            attributes: ['id', 'player_key', 'player_role', 'player_role_id', 'player_points'],
            raw: true
          })

          const q16 = []
          playersTemp16.forEach(singlePlayer => {
            q16.push({
              match_id: matchID,
              player_id: singlePlayer.id,
              team_id: team_id,
              show: '0',
              created_at: current_date_time,
              updated_at: current_date_time,
              // player_points: 0,
              player_points: singlePlayer.player_points,
              player_role: singlePlayer.player_role,
              player_role_id: singlePlayer.player_role_id
            })
          })

          await MatchPlayersModel.bulkCreate(q16)
        } // end if que1
      } // end if else
    }
  } catch (error) {
    console.log(error)
    Sentry.captureMessage(error)
  }
}

const matchFormat = function (req, res) {
  const fileName = 'football.json'
  fs.readFile('match_formats/' + fileName, 'utf8', (err, data) => {
    if (err) {
      return res.send({ type: types.error, message: messages[req.userLanguage].file_find_err, data: err })
    }
    data = JSON.parse(data)
    return res.send({ type: types.success, message: messages[req.userLanguage].is_found.replace('##', 'File'), data: data })
  })
}

const playingEleven = async (req, res) => {
  try {
    const { match_key } = req.query
    const match = await SeasonMatchesModel.findOne({
      where: { match_key, game_category: 'Football' },
      attributes: ['id', 'match_key', 'season_team_a_key', 'season_team_b_key', 'provider'],
      raw: true
    })

    if (match) {
      const matchID = match.id
      const matchKey = match.match_key

      const playersExist = await sequelize.query('SELECT a.player_id, b.player_key FROM match_players a JOIN players b ON a.player_id = b.id WHERE a.match_id = :match_id LIMIT 200;', { raw: true, replacements: { match_id: matchID }, type: Sequelize.QueryTypes.SELECT })
      const player_lineups = []

      if (match.provider === 'entity_sport') {
        const response = await axios.get(`https://soccer.entitysport.com/matches/${matchKey}/info`, { params: { token: keys.entitySportSoccerAPI } })
        const isLineupAvailable = response.data.response.items.match_info[0].lineupavailable
        if (isLineupAvailable === 'false') return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'LineUps'), data: {} })
        const data = response.data ? response.data.response.items : null
        const teamA = (data && data.lineup) ? data.lineup.home : null
        const teamB = (data && data.lineup) ? data.lineup.away : null
        const teamALineUpsPlayers = (teamA && teamA.lineup) ? teamA.lineup.player : ''
        const teamBLineUpsPlayers = (teamB && teamB.lineup) ? teamB.lineup.player : ''
        const finalPlayersData = [...teamALineUpsPlayers, ...teamBLineUpsPlayers]
        for (const data of finalPlayersData) {
          player_lineups.push(data.pid)
        }
      } else {
        const response = await axios.get(`https://api.sportradar.us/soccer-x3/global/en/matches/sr:match:${matchKey}/lineups.json`, { params: { api_key: keys.footballApiKey } })

        const data = response.data.lineups
        if (data[0].starting_lineup) {
          data[0].starting_lineup.forEach(s => {
            player_lineups.push(s.id.replace('sr:player:', ''))
          })
        }
        if (data[1].starting_lineup) {
          data[1].starting_lineup.forEach(s => {
            player_lineups.push(s.id.replace('sr:player:', ''))
          })
        }
      }

      const playerIds = []
      for (let i = 0; i < player_lineups.length; i++) {
        for (let s = 0; s < playersExist.length; s++) {
          if (player_lineups[i] == playersExist[s].player_key) {
            playerIds.push(playersExist[s].player_id)
            break
          }
        }
      }
      if (playerIds.length) {
        await MatchPlayersModel.update({ show: '1' }, {
          where: {
            player_id: { [Op.in]: playerIds },
            match_id: matchID
          }
        })

        const playersUpdate = await MatchPlayersModel.findAll({
          where: {
            player_id: { [Op.in]: playerIds },
            match_id: matchID,
            show: '1'
          },
          raw: true
        })
        return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Players'), data: playersUpdate })
      } else {
        return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'Player'), data: {} })
      }
    } else {
      return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'Match'), data: match })
    }
  } catch (error) {
    return res.send({ type: types.error, message: messages[req.userLanguage].error, data: {} })
  }
}

const matchPlayerScorePointGenerate = async function (req, res) {
  try {
    const { match_key } = req.query

    // finding match format
    const match = await SeasonMatchesModel.findOne({
      where: { match_key, game_category: 'Football' },
      attributes: ['id', 'match_format', 'provider', 'match_key', 'season_team_a_key', 'season_team_b_key', 'season_team_a_name', 'season_team_b_name'],
      raw: true
    })

    if (!match) {
      return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'Match'), data: match })
    }

    let match_format_data = fs.readFileSync('match_formats/football.json', 'utf8')
    match_format_data = JSON.parse(match_format_data)

    if (match.provider === 'entity_sport') {
      const result = await soccerScorePointByEntitySport(match, match_format_data)
      if (result.type === types.error) {
        return res.send({ type: types.error, message: result.message, data: {} })
      }
    } else {
      const response = await axios.get(`https://api.sportradar.com/soccer-extended/production/v4/en/sport_events/sr:sport_event:${match_key}/timeline.json`, { params: { api_key: keys.footballApiKey } })
      if (response.data.sport_event_status.status === 'not_started') {
        return res.send({ type: types.error, message: messages[req.userLanguage].game_not_started, data: {} })
      }

      const all_players = await sequelize.query("SELECT distinct players.id, match_players.match_id, players.player_key, 0 AS player_points, players.player_name, match_players.player_role, teams.team_key, teams.team_name, match_players.show FROM match_players JOIN players ON players.id = match_players.player_id JOIN teams ON teams.id = match_players.team_id WHERE match_id = :match_id AND match_players.`show` = '1' LIMIT 100;", { raw: true, replacements: { match_id: match.id }, type: Sequelize.QueryTypes.SELECT })

      if (!response.data.statistics.totals) response.data.statistics.totals = []

      if (!response.data.statistics) response.data.statistics = {}
      if (!response.data.statistics.totals.competitors[0].players) response.data.statistics.totals.competitors[0].players = []
      if (!response.data.statistics.totals.competitors[1].players) response.data.statistics.totals.competitors[1].players = []

      const live_data = [...response.data.statistics.totals.competitors[0].players, ...response.data.statistics.totals.competitors[1].players]

      const team_a_name = match.season_team_a_key
      const team_b_name = match.season_team_b_key

      if (!response.data.sport_event_status.period_scores[0]) response.data.sport_event_status.period_scores[0] = { home_score: 0, away_score: 0 }
      if (!response.data.sport_event_status.period_scores[1]) response.data.sport_event_status.period_scores[1] = { home_score: 0, away_score: 0 }

      const team_a_score = response.data.sport_event_status.home_score
      const team_b_score = response.data.sport_event_status.away_score

      if (live_data.length < 1 && Object.keys(match_format_data).length < 1) {
        return res.send({ type: types.error, message: messages[req.userLanguage].player_match_format_err, data: {} })
      }
      const playingElevenBonus = []
      const pointBreakup = {}
      live_data.forEach(obj => {
        let total_point = 0

        const indx = all_players.findIndex(pl => 'sr:player:' + pl.player_key === obj.id)
        if (indx > -1) {
          const plr = all_players[indx]
          if (!pointBreakup[obj.id]) pointBreakup[obj.id] = {}
          if (obj.statistics.minutes_played) { // minutes played bonus
            let pointsPlyingTime = obj.statistics.minutes_played
            if (pointsPlyingTime >= 55 && match_format_data.played_55_minutes_or_more_bonus) {
              pointsPlyingTime = match_format_data.played_55_minutes_or_more_bonus.point
              pointBreakup[obj.id].played_55_minutes_or_more_bonus = pointsPlyingTime
            } else if (pointsPlyingTime > 0 && pointsPlyingTime < 55 && match_format_data.played_less_than_55_minutes_bonus) {
              pointsPlyingTime = match_format_data.played_less_than_55_minutes_bonus.point
              pointBreakup[obj.id].played_less_than_55_minutes_bonus = pointsPlyingTime
            }
            total_point += pointsPlyingTime
          }

          if (obj.statistics.goals_scored) { // Goal scored bonus
            const g = obj.statistics.goals_scored
            let goalPoints = 0
            if (plr.player_role === 'FWD') {
              goalPoints = match_format_data.for_every_goal_scored_forward_bonus ? match_format_data.for_every_goal_scored_forward_bonus.point : goalPoints
              pointBreakup[obj.id].for_every_goal_scored_forward_bonus = goalPoints * g
            } else if (plr.player_role === 'MID') {
              goalPoints = match_format_data.for_every_goal_scored_midfielder_bonus ? match_format_data.for_every_goal_scored_midfielder_bonus.point : goalPoints
              pointBreakup[obj.id].for_every_goal_scored_midfielder_bonus = goalPoints * g
            } else if (plr.player_role === 'DEF') {
              goalPoints = match_format_data.for_every_goal_scored_defender_bonus ? match_format_data.for_every_goal_scored_defender_bonus.point : goalPoints
              pointBreakup[obj.id].for_every_goal_scored_defender_bonus = goalPoints * g
            } else if (plr.player_role === 'GK') {
              goalPoints = match_format_data.for_every_goal_scored_gk_bonus ? match_format_data.for_every_goal_scored_gk_bonus.point : goalPoints
              pointBreakup[obj.id].for_every_goal_scored_gk_bonus = goalPoints * g
            }
            total_point += goalPoints * g
          }

          if (obj.statistics.assists && match_format_data.for_every_assist_bonus) { // assist bonus
            total_point += obj.statistics.assists * match_format_data.for_every_assist_bonus.point
            pointBreakup[obj.id].for_every_assist_bonus = obj.statistics.assists * match_format_data.for_every_assist_bonus.point
          }

          if (match_format_data.for_every_5_passes_completed_bonus && obj.statistics.passes_successful >= 5) { // for every 5 passes completed
            const points = Math.floor(obj.statistics.passes_successful / 5) * match_format_data.for_every_5_passes_completed_bonus.point
            total_point += points
            pointBreakup[obj.id].for_every_5_passes_completed_bonus = points
          }

          if (obj.statistics.shots_on_target && match_format_data.for_every_1_shots_on_target_bonus) { // for every 1 shots on target
            const points = Math.floor(obj.statistics.shots_on_target / 1) * match_format_data.for_every_1_shots_on_target_bonus.point
            total_point += points
            pointBreakup[obj.id].for_every_1_shots_on_target_bonus = points
          }

          if (obj.statistics.shots_faced_saved && plr.player_role === 'GK' && match_format_data.for_every_3_shots_saved_gk_bonus) {
            const points = Math.floor(obj.statistics.shots_faced_saved / 3) * match_format_data.for_every_3_shots_saved_gk_bonus.point
            total_point += points
            pointBreakup[obj.id].for_every_3_shots_saved_gk_bonus = points
          }

          if (obj.statistics.penalties_saved && plr.player_role === 'GK' && match_format_data.for_every_penalty_saved_gk_bonus) {
            const points = obj.statistics.penalties_saved * match_format_data.for_every_penalty_saved_gk_bonus.point
            total_point += points
            pointBreakup[obj.id].for_every_penalty_saved_gk_bonus = points
          }

          if (obj.statistics.penalties_missed && match_format_data.for_every_penalty_saved_gk_bonus) {
            const points = obj.statistics.penalties_missed * match_format_data.for_every_penalty_missed_bonus.point
            total_point += points
            pointBreakup[obj.id].for_every_penalty_missed_bonus = points
          }

          if (obj.statistics.tackles_successful && match_format_data.for_every_1_successful_tackles_made_bonus) {
            const points = Math.floor(obj.statistics.tackles_successful / 1) * match_format_data.for_every_1_successful_tackles_made_bonus.point
            total_point += points
            pointBreakup[obj.id].for_every_1_successful_tackles_made_bonus = points
          }

          // query ??
          if (obj.statistics.yellow_cards && match_format_data.yellow_card_bonus) {
            const points = match_format_data.yellow_card_bonus.point
            total_point += points
            pointBreakup[obj.id].yellow_card_bonus = points
          }

          if (obj.statistics.yellow_red_cards && match_format_data.red_card_bonus) {
            const points = match_format_data.red_card_bonus.point
            total_point += points
            pointBreakup[obj.id].yellow_card_bonus = points
          }

          if (obj.statistics.own_goals && match_format_data.for_every_own_goal_bonus) {
            const points = obj.statistics.own_goals * match_format_data.for_every_own_goal_bonus.point
            total_point += points
            pointBreakup[obj.id].for_every_own_goal_bonus = points
          }

          if (obj.statistics.goals_conceded) {
            let goalConcdPOints = 0

            if (plr.player_role === 'DEF' && match_format_data.for_every_2_goal_conceded_defender_bonus) {
              const points = Math.floor(obj.statistics.goals_conceded / 2) * match_format_data.for_every_2_goal_conceded_defender_bonus.point
              goalConcdPOints = points
              pointBreakup[obj.id].for_every_2_goal_conceded_defender_bonus = points
            }

            if (plr.player_role === 'GK' && match_format_data.for_every_2_goal_conceded_gk_bonus) {
              const points = Math.floor(obj.statistics.goals_conceded / 2) * match_format_data.for_every_2_goal_conceded_gk_bonus.point
              goalConcdPOints = points
              pointBreakup[obj.id].for_every_2_goal_conceded_gk_bonus = points
            }
            total_point += goalConcdPOints
          }
          /* clean sheet pending */
if(obj.statistics.minutes_played >=6) {
          if ((team_a_name === plr.team_key && parseInt(team_b_score) === 0) || (team_b_name === plr.team_key && parseInt(team_a_score) === 0)) {
            let cleanPoint = 0
            if (plr.player_role === 'MID' && match_format_data.clean_sheet_midfielder_bonus) {
              const points = match_format_data.clean_sheet_midfielder_bonus.point
              cleanPoint = points
              pointBreakup[obj.id].clean_sheet_midfielder_bonus = points
            } else if (plr.player_role === 'DEF' && match_format_data.clean_sheet_defender_bonus) {
              const points = match_format_data.clean_sheet_defender_bonus.point
              cleanPoint = points
              pointBreakup[obj.id].clean_sheet_defender_bonus = points
            } else if (plr.player_role === 'GK' && match_format_data.clean_sheet_gk_bonus) {
              const points = match_format_data.clean_sheet_gk_bonus.point
              cleanPoint = points
              pointBreakup[obj.id].clean_sheet_gk_bonus = points
            }
            total_point += cleanPoint
          }

          all_players.forEach(playerObj => {
            if ('sr:player:' + playerObj.player_key === obj.id) {
              playerObj.player_points = playerObj.player_points + total_point
            }
          })
        }
      }) // end for each for live_data

      all_players.forEach(playerObj => {
        if (match_format_data.playing_eleven_bonus && playerObj.show == '1' && !playingElevenBonus.includes(playerObj.id)) {
          playingElevenBonus.push(playerObj.id)
          const key = `sr:player:${playerObj.player_key}`
          if (!pointBreakup[key]) pointBreakup[key] = {}
          playerObj.player_points = playerObj.player_points + match_format_data.playing_eleven_bonus.point
          pointBreakup[key].playing_eleven_bonus = match_format_data.playing_eleven_bonus.point
          pointBreakup[key].total_score = playerObj.player_points
          pointBreakup[key].player_id = playerObj.id
        }
      })

      Object.keys(pointBreakup).forEach(s => {
        PlayerScores.findOneAndUpdate({ nPlayerId: pointBreakup[s].player_id, nMatchId: match.id }, { oScores: pointBreakup[s], nTotalPoints: pointBreakup[s].total_score, dUpdatedAt: Date.now() }, { upsert: true, new: true }).then().catch(console.log)
      })

      for (let i = 0; i < all_players.length; i++) {
        const { id, player_points } = all_players[i]
        await MatchPlayersModel.update({ scored_points: player_points }, {
          where: {
            player_id: id,
            match_id: match.id
          }
        })
      }

      let winning = ''
      if (response.data.sport_event_status.winner_id) {
        response.data.sport_event.competitors.map(s => {
          if (s.id === response.data.sport_event_status.winner_id) {
            winning = `${s.name} won the match!`
          }
        })
      }

      await SeasonMatchesModel.update({ team_a_score, team_b_score, winning }, {
        where: {
          id: match.id
        }
      })
    }
    return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Point') })
  } catch (error) {
    return catchError('footballapiController.matchPlayerScorePointGenerate', error, req, res)
  }
}

const enititySportsCalculation = async (req, res) => {
  try {
    const response = await axios.get(`https://soccer.entitysport.com/matches/${req.query.match_key}/newfantasy`, { params: { token: keys.entitySportSoccerAPI } })
    if (!response.data.response.items) {
      return res.send({ type: types.error, message: messages[req.userLanguage].game_not_started, data: {} })
    }
    let match_format_data = fs.readFileSync('match_formats/football.json', 'utf8')
    match_format_data = JSON.parse(match_format_data)

    if (!response.data.response.items.teams.home) response.data.response.items.teams.home = []
    if (!response.data.response.items.teams.away) response.data.response.items.teams.away = []

    const all_players = {}

    response.data.response.items.teams.home.forEach(s => {
      all_players[s.pid] = s
    })

    response.data.response.items.teams.away.forEach(s => {
      all_players[s.pid] = s
    })

    if (response.data.response.items.playerstats.home) {
      response.data.response.items.playerstats.home = response.data.response.items.playerstats.home.map(singlePlayer => {
        calculateForEnitity(singlePlayer, all_players, match_format_data)
        return singlePlayer
      })
    }

    if (response.data.response.items.playerstats.away) {
      response.data.response.items.playerstats.away = response.data.response.items.playerstats.away.map(singlePlayer => {
        calculateForEnitity(singlePlayer, all_players, match_format_data)
        return singlePlayer
      })
    }
    return res.jsonp(response.data)
  } catch (error) {
    return catchError('footballapiController.enititySportsCalculation', error, req, res)
  }
}

const calculateForEnitity = (singlePlayer, all_players, match_format_data) => {
  let total_point = 0
  const plr = all_players[singlePlayer.pid.toString()]
  if (!plr) {
    singlePlayer.total_point = 0
    return singlePlayer
  }
  if (singlePlayer.minutesplayed) {
    if (singlePlayer.minutesplayed >= 55 && match_format_data.played_55_minutes_or_more_bonus) {
      total_point += match_format_data.played_55_minutes_or_more_bonus.point
      singlePlayer.minutesplayed = `${match_format_data.played_55_minutes_or_more_bonus.point} (${singlePlayer.minutesplayed})`
    } else if (singlePlayer.minutesplayed > 0 && singlePlayer.minutesplayed < 55 && match_format_data.played_less_than_55_minutes_bonus) {
      total_point += match_format_data.played_less_than_55_minutes_bonus.point
      singlePlayer.minutesplayed = `${match_format_data.played_less_than_55_minutes_bonus.point} (${singlePlayer.minutesplayed})`
    }
  }

  if (singlePlayer.goalscored) {
    const g = singlePlayer.goalscored
    let goalPoints = 0
    if (plr.role === 'Forward') {
      goalPoints = match_format_data.for_every_goal_scored_forward_bonus ? match_format_data.for_every_goal_scored_forward_bonus.point : goalPoints
    } else if (plr.role === 'Midfielder') {
      goalPoints = match_format_data.for_every_goal_scored_midfielder_bonus ? match_format_data.for_every_goal_scored_midfielder_bonus.point : goalPoints
    } else if (plr.role === 'Defender') {
      goalPoints = match_format_data.for_every_goal_scored_defender_bonus ? match_format_data.for_every_goal_scored_defender_bonus.point : goalPoints
    } else if (plr.role === 'Goalkeeper') {
      goalPoints = match_format_data.for_every_goal_scored_gk_bonus ? match_format_data.for_every_goal_scored_gk_bonus.point : goalPoints
    }
    total_point += goalPoints * g
    singlePlayer.goalscored = `${goalPoints * g} (${singlePlayer.goalscored})`
  }

  if (singlePlayer.assists && match_format_data.for_every_assist_bonus) { // assist bonus
    total_point += singlePlayer.assists * match_format_data.for_every_assist_bonus.point
    singlePlayer.assists = `${singlePlayer.assists * match_format_data.for_every_assist_bonus.point} (${singlePlayer.assists})`
  }

  if (match_format_data.for_every_5_passes_completed_bonus && singlePlayer.passes >= 5) { // for every 5 passes completed
    const points = Math.floor(singlePlayer.passes / 5) * match_format_data.for_every_5_passes_completed_bonus.point
    total_point += points
    singlePlayer.passes = `${points} (${singlePlayer.passes})`
  }

  if (singlePlayer.shotsontarget && match_format_data.for_every_1_shots_on_target_bonus) { // for every 1 shots on target
    const points = Math.floor(singlePlayer.shotsontarget / 1) * match_format_data.for_every_1_shots_on_target_bonus.point
    total_point += points
    singlePlayer.shotsontarget = `${points} (${singlePlayer.shotsontarget})`
  }

  if (singlePlayer.shotssaved && plr.role === 'Goalkeeper' && match_format_data.for_every_3_shots_saved_gk_bonus) {
    const points = Math.floor(singlePlayer.shotssaved / 3) * match_format_data.for_every_3_shots_saved_gk_bonus.point
    total_point += points
    singlePlayer.shotssaved = `${points} (${singlePlayer.shotssaved})`
  }

  if (singlePlayer.penaltysaved && plr.player_role === 'Goalkeeper' && match_format_data.for_every_penalty_saved_gk_bonus) {
    const points = singlePlayer.penaltysaved * match_format_data.for_every_penalty_saved_gk_bonus.point
    total_point += points
    singlePlayer.penaltysaved = `${points} (${singlePlayer.penaltysaved})`
  }

  if (singlePlayer.penalties_missed && match_format_data.for_every_penalty_saved_gk_bonus) {
    const points = singlePlayer.statistics.penalties_missed * match_format_data.for_every_penalty_missed_bonus.point
    total_point += points
    singlePlayer.penaltymissed = `${points} (${singlePlayer.penaltymissed})`
  }

  if (singlePlayer.tacklesuccessful && match_format_data.for_every_1_successful_tackles_made_bonus) {
    const points = Math.floor(singlePlayer.tacklesuccessful / 1) * match_format_data.for_every_1_successful_tackles_made_bonus.point
    total_point += points
    singlePlayer.tacklesuccessful = `${points} (${singlePlayer.tacklesuccessful})`
  }

  if (singlePlayer.yellowcard && match_format_data.yellow_card_bonus) {
    const points = match_format_data.yellow_card_bonus.point
    total_point += points
    singlePlayer.yellowcard = `${points} (${singlePlayer.yellowcard})`
  }

  if (singlePlayer.redcard && match_format_data.red_card_bonus) {
    const points = match_format_data.red_card_bonus.point
    total_point += points
    singlePlayer.redcard = `${points} (${singlePlayer.redcard})`
  }

  if (singlePlayer.owngoal && match_format_data.for_every_own_goal_bonus) {
    const points = singlePlayer.owngoal * match_format_data.for_every_own_goal_bonus.point
    total_point += points
    singlePlayer.owngoal = `${points} (${singlePlayer.owngoal})`
  }

  if (singlePlayer.starting11 && match_format_data.playing_eleven_bonus) {
    const points = singlePlayer.starting11 * match_format_data.playing_eleven_bonus.point
    total_point += points
    singlePlayer.starting11 = `${points} (${singlePlayer.starting11})`
  }

  if (singlePlayer.goalsconceded) {
    let goalConcdPOints = 0
    if (plr.role === 'Defender' && match_format_data.for_every_2_goal_conceded_defender_bonus) {
      const points = Math.floor(singlePlayer.goalsconceded / 2) * match_format_data.for_every_2_goal_conceded_defender_bonus.point
      goalConcdPOints = points
    }

    if (plr.role === 'Goalkeeper' && match_format_data.for_every_2_goal_conceded_gk_bonus) {
      const points = Math.floor(singlePlayer.goalsconceded / 2) * match_format_data.for_every_2_goal_conceded_gk_bonus.point
      goalConcdPOints = points
    }
    total_point += goalConcdPOints
    singlePlayer.goalsconceded = `${goalConcdPOints} (${singlePlayer.goalsconceded})`
  }

  if (singlePlayer.cleansheet) {
    let cleanPoint = 0
    if (plr.role === 'Midfielder' && match_format_data.clean_sheet_midfielder_bonus) {
      const points = match_format_data.clean_sheet_midfielder_bonus.point
      cleanPoint = points
    } else if (plr.role === 'Defender' && match_format_data.clean_sheet_defender_bonus) {
      const points = match_format_data.clean_sheet_defender_bonus.point
      cleanPoint = points
    } else if (plr.role === 'Goalkeeper' && match_format_data.clean_sheet_gk_bonus) {
      const points = match_format_data.clean_sheet_gk_bonus.point
      cleanPoint = points
    }
    total_point += cleanPoint
    singlePlayer.cleansheet = `${cleanPoint} (${singlePlayer.cleansheet})`
  }
  singlePlayer.total_point = total_point
  return singlePlayer
}

async function getEntitySportSoccerData (date, endDate, userLanguage) {
  try {
    const current_date_time = getFiveThirtyPlusDate()
    let page = 1
    let totalPages = 1
    const data = []

    while (page <= totalPages) {
      try {
        const result = await axios.get('https://soccer.entitysport.com/matches',
          {
            params: {
              token: keys.entitySportSoccerAPI,
              date: date + '_' + endDate,
              paged: page
            }
          })

        if (result.data.response && result.data.response.total_pages) {
          totalPages = result.data.response.total_pages
        }
        if (result.data.response && result.data.response.items) {
          data.push(...result.data.response.items)
        }
      } catch (error) {
        console.log('Error in fetch Soccer matches', error)
      }
      page++
    }

    const match_keys = []
    const teamKeysForImg = []
    for (let i = 0; i < data.length; i++) {
      teamKeysForImg.push(data[i].teams.home.tid)
      teamKeysForImg.push(data[i].teams.away.tid)
      match_keys.push(data[i].mid)
    }

    const teamImages = await TeamsModel.findAll({
      where: { team_key: teamKeysForImg, game_category: 'Football', provider: 'entity_sport' },
      attributes: ['team_key', 'team_img'],
      group: 'team_key',
      raw: true
    })

    const matches = await SeasonMatchesModel.findAll({
      where: { match_key: match_keys, game_category: 'Football' },
      attributes: ['match_key'],
      raw: true
    })

    const matchIds = matches.map(s => s.match_key)

    const newMatches = []
    const teamsIds = []

    data.forEach(sportEvent => {
    // eslint-disable-next-line camelcase
      const { mid: match_id, teams, competition, venue, datestart: date_start } = sportEvent
      const homeTeam = teams.home
      const awayTeam = teams.away

      if (!matchIds.includes(match_id.toString())) {
        let gender = 'Men'

        if (competition && competition.cname.indexOf('Women') !== -1) {
          gender = 'Women'
        }
        const tour_type = 'football'

        const dt = new Date(date_start)
        if (keys.multiVersions === 'bangla') {
          dt.setHours(dt.getHours() + 6)
        } else {
          dt.setHours(dt.getHours() + 5)
          dt.setMinutes(dt.getMinutes() + 30)
        }
        const start_date = new Date(dt).toISOString().replace(/T/, ' ').replace(/\..+/, '')
        let team_a_img = ''
        let team_b_img = ''
        const team_a_key = (homeTeam) ? homeTeam.tid : ''
        const team_b_key = (awayTeam) ? awayTeam.tid : ''
        const team_a_name = (gender === 'Women') ? homeTeam.tname.toString().concat(' -Women') : homeTeam.tname
        const team_b_name = (gender === 'Women') ? awayTeam.tname.toString().concat(' -Women') : awayTeam.tname

        if (teamImages.length) {
          for (let s = 0; s < teamImages.length; s++) {
            if (teamImages[s].team_key == team_a_key) {
              team_a_img = teamImages[s].team_img
              break
            }
          }
          for (let s = 0; s < teamImages.length; s++) {
            if (teamImages[s].team_key == team_b_key) {
              team_b_img = teamImages[s].team_img
              break
            }
          }
        }

        const checkAKey = obj => obj.team_key == team_a_key
        const checkBKey = obj => obj.team_key == team_b_key

        if ((!teamImages.some(checkAKey)) && (!teamsIds.some(checkAKey))) {
          teamsIds.push({ key: team_a_key, name: team_a_name })
        }

        if ((!teamImages.some(checkBKey)) && (!teamsIds.some(checkBKey))) {
          teamsIds.push({ key: team_b_key, name: team_b_name })
        }

        let competitionName = '-'
        if (competition) {
          competitionName = competition.cname.toString().concat(' ', competition.year)
          if (gender === 'Women') competitionName.concat(' -Women')
        }

        newMatches.push({
          season_key: competition ? competition.cid : '',
          match_key: match_id,
          match_format: tour_type || 'football',
          short_name: homeTeam.abbr + ' vs ' + awayTeam.abbr,
          season_name: competitionName,
          venue: venue ? venue.name.toString().concat(', ', venue.location) : null,
          status: 'Pending',
          start_date,
          entry_close_time: start_date,
          season_team_a_key: team_a_key,
          season_team_b_key: team_b_key,
          season_team_a_name: team_a_name,
          season_team_b_name: team_b_name,
          season_team_a_img: team_a_img,
          season_team_b_img: team_b_img,
          game_category: 'Football',
          provider: 'entity_sport',
          created_at: current_date_time,
          updated_at: current_date_time
        })
      }
    })

    const newTeams = []
    teamsIds.forEach(singleTeam => {
      newTeams.push({
        team_key: singleTeam.key,
        team_name: singleTeam.name,
        game_category: 'Football',
        provider: 'entity_sport',
        created_at: current_date_time,
        updated_at: current_date_time
      })
    })

    if (newMatches && newMatches.length) {
      await SeasonMatchesModel.bulkCreate(newMatches)
    }
    if (newTeams && newTeams.length) {
      await TeamsModel.bulkCreate(newTeams)
    }
    return { type: types.success, message: messages[userLanguage].match_uploaded, data: {} }
  } catch (error) {
    return { type: types.error, message: messages[userLanguage].err_occurred, data: error }
  }
}

async function soccerScorePointByEntitySport (match, matchFormatData) {
  const userLanguage = 'en'
  try {
    let response
    try {
      response = await axios.get(`https://soccer.entitysport.com/matches/${match.match_key}/newfantasy`, { params: { token: keys.entitySportSoccerAPI } })
    } catch (error) {
      return { type: types.error, message: messages[userLanguage].game_not_started, data: {} }
    }
    const isScoresAvailable = response.data.response.items.match_info.status

    if (!['2', '3'].includes(isScoresAvailable)) {
      return { type: types.error, message: messages[userLanguage].game_not_started, data: {} }
    }

    const aScorePointsData = response.data.response.items.playerstats || {}
    const teamAScore = response.data.response.items.match_info.result.home
    const teamBScore = response.data.response.items.match_info.result.away
    const teamAScores = aScorePointsData.home || []
    const teamBScores = aScorePointsData.away || []
    const { season_team_a_key, season_team_b_key, id, season_team_a_name, season_team_b_name } = match

    const liveData = [...teamAScores, ...teamBScores]

    if (liveData.length < 1) {
      return { type: types.error, message: messages[userLanguage].game_not_started, data: {} }
    }

    const all_players = await sequelize.query("SELECT distinct players.id, match_players.match_id, players.player_key, 0 AS player_points, players.player_name, match_players.player_role, teams.team_key, teams.team_name, match_players.show FROM match_players JOIN players ON players.id = match_players.player_id JOIN teams ON teams.id = match_players.team_id WHERE match_id = :match_id AND match_players.`show` = '1' LIMIT 100;", { raw: true, replacements: { match_id: match.id }, type: Sequelize.QueryTypes.SELECT })

    const playingElevenBonus = []
    const pointBreakup = {}
    liveData.forEach(obj => {
      let totalPoint = 0
      obj.id = obj.pid.toString()
      const indx = all_players.findIndex(pl => pl.player_key === obj.id)
      if (indx > -1) {
        const plr = all_players[indx]
        if (!pointBreakup[obj.id]) pointBreakup[obj.id] = {}
        if (obj.minutesplayed) { // minutes played bonus
          let pointsPlyingTime = obj.minutesplayed
          if (pointsPlyingTime >= 55 && matchFormatData.played_55_minutes_or_more_bonus) {
            pointsPlyingTime = matchFormatData.played_55_minutes_or_more_bonus.point
            pointBreakup[obj.id].played_55_minutes_or_more_bonus = pointsPlyingTime
          } else if (pointsPlyingTime > 0 && pointsPlyingTime < 55 && matchFormatData.played_less_than_55_minutes_bonus) {
            pointsPlyingTime = matchFormatData.played_less_than_55_minutes_bonus.point
            pointBreakup[obj.id].played_less_than_55_minutes_bonus = pointsPlyingTime
          }
          totalPoint += pointsPlyingTime
        }

        if (obj.goalscored) { // Goal scored bonus
          const g = obj.goalscored
          let goalPoints = 0
          if (plr.player_role === 'FWD') {
            goalPoints = matchFormatData.for_every_goal_scored_forward_bonus ? matchFormatData.for_every_goal_scored_forward_bonus.point : goalPoints
            pointBreakup[obj.id].for_every_goal_scored_forward_bonus = goalPoints * g
          } else if (plr.player_role === 'MID') {
            goalPoints = matchFormatData.for_every_goal_scored_midfielder_bonus ? matchFormatData.for_every_goal_scored_midfielder_bonus.point : goalPoints
            pointBreakup[obj.id].for_every_goal_scored_midfielder_bonus = goalPoints * g
          } else if (plr.player_role === 'DEF') {
            goalPoints = matchFormatData.for_every_goal_scored_defender_bonus ? matchFormatData.for_every_goal_scored_defender_bonus.point : goalPoints
            pointBreakup[obj.id].for_every_goal_scored_defender_bonus = goalPoints * g
          } else if (plr.player_role === 'GK') {
            goalPoints = matchFormatData.for_every_goal_scored_gk_bonus ? matchFormatData.for_every_goal_scored_gk_bonus.point : goalPoints
            pointBreakup[obj.id].for_every_goal_scored_gk_bonus = goalPoints * g
          }
          totalPoint += goalPoints * g
        }

        if (obj.assist && matchFormatData.for_every_assist_bonus) { // assist bonus
          totalPoint += obj.assist * matchFormatData.for_every_assist_bonus.point
          pointBreakup[obj.id].for_every_assist_bonus = obj.assist * matchFormatData.for_every_assist_bonus.point
        }

        if (matchFormatData.for_every_5_passes_completed_bonus && obj.passes >= 5) { // for every 5 passes completed
          const points = Math.floor(obj.passes / 5) * matchFormatData.for_every_5_passes_completed_bonus.point
          totalPoint += points
          pointBreakup[obj.id].for_every_5_passes_completed_bonus = points
        }

        if (obj.shotsontarget && matchFormatData.for_every_1_shots_on_target_bonus) { // for every 1 shots on target
          const points = Math.floor(obj.shotsontarget / 1) * matchFormatData.for_every_1_shots_on_target_bonus.point
          totalPoint += points
          pointBreakup[obj.id].for_every_1_shots_on_target_bonus = points
        }

        if (obj.shotssaved && plr.player_role === 'GK' && matchFormatData.for_every_3_shots_saved_gk_bonus) {
          const points = Math.floor(obj.shotssaved / 3) * matchFormatData.for_every_3_shots_saved_gk_bonus.point
          totalPoint += points
          pointBreakup[obj.id].for_every_3_shots_saved_gk_bonus = points
        }

        if (obj.penaltysaved && plr.player_role === 'GK' && matchFormatData.for_every_penalty_saved_gk_bonus) {
          const points = obj.penaltysaved * matchFormatData.for_every_penalty_saved_gk_bonus.point
          totalPoint += points
          pointBreakup[obj.id].for_every_penalty_saved_gk_bonus = points
        }

        if (obj.penaltymissed && matchFormatData.for_every_penalty_saved_gk_bonus) {
          const points = obj.penaltymissed * matchFormatData.for_every_penalty_missed_bonus.point
          totalPoint += points
          pointBreakup[obj.id].for_every_penalty_missed_bonus = points
        }

        if (obj.tacklesuccessful && matchFormatData.for_every_1_successful_tackles_made_bonus) {
          const points = Math.floor(obj.tacklesuccessful / 1) * matchFormatData.for_every_1_successful_tackles_made_bonus.point
          totalPoint += points
          pointBreakup[obj.id].for_every_1_successful_tackles_made_bonus = points
        }

        // query ??
        if (obj.yellowcard && matchFormatData.yellow_card_bonus) {
          const points = matchFormatData.yellow_card_bonus.point
          totalPoint += points
          pointBreakup[obj.id].yellow_card_bonus = points
        }

        if (obj.redcard && matchFormatData.red_card_bonus) {
          const points = matchFormatData.red_card_bonus.point
          totalPoint += points
          pointBreakup[obj.id].red_card_bonus = points
        }

        if (obj.owngoal && matchFormatData.for_every_own_goal_bonus) {
          const points = obj.owngoal * matchFormatData.for_every_own_goal_bonus.point
          totalPoint += points
          pointBreakup[obj.id].for_every_own_goal_bonus = points
        }

        if (obj.goalsconceded) {
          let goalConcdPOints = 0

          if (plr.player_role === 'DEF' && matchFormatData.for_every_2_goal_conceded_defender_bonus) {
            const points = Math.floor(obj.goalsconceded / 2) * matchFormatData.for_every_2_goal_conceded_defender_bonus.point
            goalConcdPOints = points
            pointBreakup[obj.id].for_every_2_goal_conceded_defender_bonus = points
          }

          if (plr.player_role === 'GK' && matchFormatData.for_every_2_goal_conceded_gk_bonus) {
            const points = Math.floor(obj.goalsconceded / 2) * matchFormatData.for_every_2_goal_conceded_gk_bonus.point
            goalConcdPOints = points
            pointBreakup[obj.id].for_every_2_goal_conceded_gk_bonus = points
          }
          totalPoint += goalConcdPOints
        }
        // clean sheet pending

        if ((season_team_a_key === plr.team_key && parseInt(teamBScore) === 0) || (season_team_b_key === plr.team_key && parseInt(teamAScore) === 0)) {
          if (obj.cleansheet) {
            let cleanPoint = 0
            if (plr.player_role === 'MID' && matchFormatData.clean_sheet_midfielder_bonus) {
              const points = matchFormatData.clean_sheet_midfielder_bonus.point
              cleanPoint = points
              pointBreakup[obj.id].clean_sheet_midfielder_bonus = points
            } else if (plr.player_role === 'DEF' && matchFormatData.clean_sheet_defender_bonus) {
              const points = matchFormatData.clean_sheet_defender_bonus.point
              cleanPoint = points
              pointBreakup[obj.id].clean_sheet_defender_bonus = points
            } else if (plr.player_role === 'GK' && matchFormatData.clean_sheet_gk_bonus) {
              const points = matchFormatData.clean_sheet_gk_bonus.point
              cleanPoint = points
              pointBreakup[obj.id].clean_sheet_gk_bonus = points
            }
            totalPoint += cleanPoint
          }
        }
        all_players.forEach(playerObj => {
          if (playerObj.player_key === obj.id) {
            playerObj.player_points = totalPoint
          }
        })
      }
    }) // end for each for liveData

    all_players.forEach(playerObj => {
      if (matchFormatData.playing_eleven_bonus && playerObj.show === '1' && !playingElevenBonus.includes(playerObj.id)) {
        playingElevenBonus.push(playerObj.id)
        const key = playerObj.player_key
        if (!pointBreakup[key]) pointBreakup[key] = {}
        playerObj.player_points += matchFormatData.playing_eleven_bonus.point
        pointBreakup[key].playing_eleven_bonus = matchFormatData.playing_eleven_bonus.point
        pointBreakup[key].total_score = playerObj.player_points
        pointBreakup[key].player_id = playerObj.id
      }
    })

    Object.keys(pointBreakup).forEach(s => {
      PlayerScores.findOneAndUpdate({ nPlayerId: pointBreakup[s].player_id, nMatchId: match.id.toString() }, { oScores: pointBreakup[s], nTotalPoints: pointBreakup[s].total_score, dUpdatedAt: Date.now() }, { upsert: true, new: true }).then().catch(console.log)
    })

    for (let i = 0; i < all_players.length; i++) {
      const { id, player_points } = all_players[i]
      await MatchPlayersModel.update({ scored_points: player_points }, {
        where: {
          player_id: id,
          match_id: match.id
        }
      })
    }

    let winning = ''
    if (response.data.response.items.match_info.result.winner === 'home') {
      winning = `${season_team_a_name} won the match!`
    } else if (response.data.response.items.match_info.result.winner === 'away') {
      winning = `${season_team_b_name} won the match!`
    }

    await SeasonMatchesModel.update({ team_a_score: teamAScore, team_b_score: teamBScore, winning }, {
      where: {
        id: match.id
      }
    })

    return { type: types.success, message: messages[userLanguage].updated_succ.replace('##', 'Point'), data: {} }
  } catch (error) {
    console.log(error)
    return { type: types.error, message: messages[userLanguage].game_not_started, data: {} }
  }
}

module.exports = {
  schedule,
  addPlayers,
  matchFormat,
  playingEleven,
  matchPlayerScorePointGenerate,
  enititySportsCalculation
}
