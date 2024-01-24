/* eslint-disable camelcase */
/* eslint-disable prefer-promise-reject-errors */
const Sentry = require('@sentry/node')
const { queuePop } = require('./../services/memoryCache')
const { getFiveThirtyPlusDate } = require('./../api.response')
const {
  models: {
    user_leagues: UserLeaguesModel
  }
} = require('../services/sqlConnect')

const doAssignPoint = async () => {
  try {
    let data = await queuePop('generateAssignPoints')

    if (!data) {
      setTimeout(() => { doAssignPoint() }, 5000)
      return
    }
    console.log('generateAssignPoints', data)
    data = JSON.parse(data)

    const current_date_time = getFiveThirtyPlusDate()

    await UserLeaguesModel.update(
      {
        total_points: data.total_points,
        assign_points: 1,
        updated_at: current_date_time
      },
      { where: { user_team_id: data.user_team_id } }
    )
    doAssignPoint()
  } catch (error) {
    console.log(error)
    Sentry.captureMessage(error)
    doAssignPoint()
  }
}

setTimeout(() => {
  doAssignPoint()
}, 5000)

module.exports = {
  doAssignPoint
}
