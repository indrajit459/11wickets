/* eslint-disable eqeqeq */
/* eslint-disable camelcase */
const Notifications = require('../models/notifications.model')
const NotificationTypes = require('../models/notificationtypes.model')
const Sequelize = require('sequelize')
const sequelize = require('../services/sqlConnect').sequelize
const { validationResult } = require('express-validator/check')
const { catchError, messages, status, getFiveThirtyPlusDate, types } = require('./../api.response')
const { pick, removenull } = require('../config/helpers')

const store = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) { return res.send({ type: types.error, message: errors.array() }) }

    req.body = pick(req.body, ['type', 'title', 'message'])
    removenull(req.body)
    const current_date_time = getFiveThirtyPlusDate()
    const { type } = req.body

    // req.body.time = getFiveThirtyPlusDate(req.body.time)

    const user = await sequelize.query('SELECT id FROM users WHERE id=:user_id LIMIT 1;', { raw: true, replacements: { user_id: req.params.user_id }, type: Sequelize.QueryTypes.SELECT })
    if (!user.length) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].wrong_with.replace('##', 'User ID') })

    const notiType = await NotificationTypes.findById(type)
    if (!notiType) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].wrong_with.replace('##', 'Type ID') })

    const newNotification = new Notifications({ user_id: user[0].id, ...req.body, status: 0, created_at: current_date_time })
    await newNotification.save()

    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'Notification') })
  } catch (error) {
    catchError('notificationController.store', error, req, res)
  }
}

const storeTimedNotification = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) { return res.send({ type: types.error, message: errors.array() }) }

    req.body = pick(req.body, ['type', 'title', 'message', 'time'])
    removenull(req.body)
    const current_date_time = getFiveThirtyPlusDate()
    const { type } = req.body

    req.body.time = getFiveThirtyPlusDate(req.body.time)

    const notiType = await NotificationTypes.findById(type)
    if (!notiType) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].wrong_with.replace('##', 'Type ID') })

    const newNotification = new Notifications({ ...req.body, aReadIds: [], status: 0, created_at: current_date_time })
    await newNotification.save()

    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'Notification') })
  } catch (error) {
    catchError('notificationController.store', error, req, res)
  }
}

const list = async (req, res) => {
  try {
    const { limit, offset, aFilters } = req.body
    const queryLimit = parseInt(limit) || 20
    const queryOffset = parseInt(offset) || 0
    const filterQuery = { $or: [] }
    const matchQuery = { $and: [{ $or: [{ user_id: { $exists: false } }, { user_id: req.user.id.toString() }] }] }

    if (aFilters && aFilters.length) {
      aFilters.map(s => filterQuery.$or.push({ type: s }))
      matchQuery.$and.push(filterQuery)
    }
    const notifications = await Notifications.aggregate([
      { $match: matchQuery },
      {
        $project: {
          _id: 1,
          status: {
            $cond: [
              '$time',
              { $cond: [{ $in: [req.user.id.toString(), '$aReadIds'] }, 1, 0] },
              '$status']
          },
          title: 1,
          message: 1,
          time: 1,
          created_at: 1
        }
      },
      { $sort: { created_at: -1 } },
      { $skip: queryOffset },
      { $limit: queryLimit }
    ]).exec()

    const updateIds = []
    const timeIds = []
    notifications.map(s => {
      if (s.time && !s.status) {
        timeIds.push(s._id)
      } else if (!s.status) {
        updateIds.push(s._id)
      }
    })

    if (updateIds.length) await Notifications.updateMany({ _id: { $in: updateIds } }, { $set: { status: 1 } })
    if (timeIds.length) await Notifications.updateMany({ _id: { $in: timeIds } }, { $addToSet: { aReadIds: req.user.id.toString() } })

    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].success, data: notifications })
  } catch (error) {
    catchError('notificationController.list', error, req, res)
  }
}

const unreadCount = async (req, res) => {
  try {
    const count = await Notifications.aggregate([
      { $match: { $or: [{ user_id: { $exists: false } }, { user_id: req.user.id.toString() }] } },
      {
        $project: {
          status: {
            $cond: [
              '$time',
              { $cond: [{ $in: [req.user.id.toString(), '$aReadIds'] }, 1, 0] },
              '$status']
          }
        }
      },
      { $match: { status: 0 } },
      { $count: 'status' }
    ]).exec()
    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].success, data: { unread_count: count[0] ? count[0].status : 0 } })
  } catch (error) {
    catchError('notificationController.unreadCount', error, req, res)
  }
}

const listNotificationType = async (req, res) => {
  try {
    const type = await NotificationTypes.find({ status: 1 }, { _id: 1, heading: 1, description: 1 })
    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].success, data: type })
  } catch (error) {
    catchError('notificationController.listNotificationType', error, req, res)
  }
}

const removeTimedNotifications = async (req, res) => {
  try {
    const dt = new Date().getTime() + 19800000
    console.log(new Date(), new Date().getTime() + 19800000)
    const data = await Notifications.find({ time: { $exists: true, $lt: new Date(dt) } }).limit(50).sort({ created_at: -1 })
    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].success, data })
  } catch (error) {
    catchError('notificationController.removeTimedNotifications', error, req, res)
  }
}

module.exports = {
  store,
  storeTimedNotification,
  list,
  unreadCount,
  listNotificationType,
  removeTimedNotifications
}
