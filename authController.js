/* eslint-disable no-async-promise-executor */
/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable camelcase */
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const axios = require('axios')
const { Op } = require('sequelize')
const {
  models: {
    users: UsersModel,
    mobile_verification: MobileVerificationModel,
    jio_users: JioUsersModel
  }
} = require('./../services/sqlConnect')
const keys = require('../config/keys')
const { sendOtp, sendMailOTP, sendOtpBangla } = require('./utilitiesController')
const { messages, catchError, status, types, checkRateLimitLogin, getFiveThirtyPlusDate, checkRateLimitEmail } = require('../api.response')
const { redisClient2 } = require('./../services/memoryCache')
const passbookController = require('../controllers/passbookController')
const { checkUsernameExistence } = require('../controllers/extraController')
const { verifyIdToken } = require('./appleLoginController')
const { modifyGmailEmail } = require('../config/helpers')

const saltRounds = 10

const otpGenerateFunction = async (phone, type, ip) => {
  return new Promise(async (resolve, reject) => {
    try {
      const isEmail = phone.match(/[a-z]/i)

      if (keys.multiVersions !== 'bangla') {
        let phone_otp = Math.floor(Math.random() * (999999 - 100000 + 1) + 100000)

        if (phone == '8200498980' || phone == '8511151826' || phone == '7600787089' || phone == '7016995443' || phone == '8200949540' || phone == '9123245652' ) {
          phone_otp = 111111
        }

        checkRateLimitLogin(ip[0]).then(async () => {
          checkRateLimitEmail(phone).then(async () => {
            if (isEmail) { // send mail otp
              sendMailOTP(phone, phone_otp)
            } else { // send phone otp
              await sendOtp(phone, phone_otp)
            }

            const isExists = await MobileVerificationModel.findOne({
              where: { mobile_number: phone, type }
            })
            if (isExists) {
              isExists.code = phone_otp
              isExists.is_verify = 'n'
              isExists.type = type
              await isExists.save()
            } else {
              await MobileVerificationModel.create({
                mobile_number: phone,
                code: phone_otp,
                is_verify: 'n',
                type
              })
            }
            return resolve('success')
          }).catch(error => {
            console.log({ error })
            return reject(error)
          })
        }).catch(error => {
          console.log({ error })
          return reject(error)
        })
      } else {
        let phone_otp = Math.floor(Math.random() * (999999 - 100000 + 1) + 100000)

        if (phone == '8200498980' || phone == '8511151826' || phone == '7600787089' || phone == '7016995443' || phone == '8200949540'  || phone == '9123245652' ) {
          phone_otp = 111111
        }

        checkRateLimitLogin(ip[0]).then(async () => {
          checkRateLimitEmail(phone).then(async () => {
            if (isEmail) { // send mail otp
              sendMailOTP(phone, phone_otp)
            } else { // send phone otp
              sendOtpBangla(phone, phone_otp)
            }
            const isExists = await MobileVerificationModel.findOne({
              where: { mobile_number: phone.toString(), type }
            })
            if (isExists) {
              isExists.code = phone_otp
              isExists.is_verify = 'n'
              isExists.type = type

              await isExists.save()
            } else {
              await MobileVerificationModel.create({
                mobile_number: phone,
                code: phone_otp,
                is_verify: 'n',
                type
              })
            }
            return resolve('success')
          }).catch(error => {
            console.log({ error })
            return reject(error)
          })
        }).catch(error => {
          console.log({ error })
          return reject(error)
        })
      }
    } catch (error) {
      console.log({ error })
      return reject(error)
    }
  })
}

const sendOtpUser = async (req, res) => {
  if (!req.headers['user-agent']) {
    return res.status(status.BadRequest).jsonp({
      type: types.error,
      message: messages[req.userLanguage].error
    })
  }
  const { phone: reqPhone, type } = req.body
  const isEmail = reqPhone.match(/[a-z]/i)
  let phone = reqPhone

  if (!isEmail) {
    const regex = /^\d{10}$/
    const regexResult = regex.test(reqPhone.trim())
    if (!regexResult) {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].mobile_number_validation })
    }
  } else {
    const result = modifyGmailEmail(reqPhone)
    if (!result.success) {
      return res.send({ type: types.error, message: result.message, data: {} })
    }
    phone = result.email
  }
  if (type === 'forgot') {
    const user = await UsersModel.findOne({
      where: {
        [Op.or]: [
          { email: phone },
          { phone }
        ],
        role_id: 2
      }
    })
    if (!user) return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].auth_fail })
    await redisClient2.del(`at:${user.api_token}`)
  }

  if (type === 'change') {
    if (!req.headers.authorization) return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].auth_fail })
    if (isEmail) {
      const user = await UsersModel.findOne({
        where: { api_token: req.headers.authorization }
      })

      if (!user) return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].auth_fail })

      if (user.email === phone && user.email_verify === '1') {
        return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].email_verified })
      } else if (user.email !== phone) {
        const emailExists = await UsersModel.findOne({
          where: { email: phone }
        })
        if (emailExists) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].email_exists })
      }
      user.email = phone
      user.email_verify = '0'
      await user.save()
    } else {
      const user = await UsersModel.findOne({
        where: { api_token: req.headers.authorization }
      })
      if (!user) return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].auth_fail })
      if (user.phone === phone && user.phone_verify === '1') {
        return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].mob_verified })
      } else if (user.phone !== phone) {
        const phoneExists = await UsersModel.findOne({
          where: { phone: phone }
        })
        if (phoneExists) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].phone_exists })
      }
      user.phone = phone
      user.phone_verify = '0'
      await user.save()
    }
  }

  const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',') : []
  otpGenerateFunction(phone, type, ip).then(() => {
    return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].success })
  }).catch(error => {
    return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage][error] ? messages[req.userLanguage][error] : error })
  })
}

const login = async (req, res) => {
  try {
    const { password, phone: reqPhone } = req.body
    const isEmail = reqPhone.match(/[a-z]/i)
    let phone = reqPhone

    if (isEmail) {
      const result = modifyGmailEmail(reqPhone)
      if (!result.success) {
        return res.send({ type: types.error, message: result.message, data: {} })
      }
      phone = result.email
    }

    const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',') : []
    // checkRateLimitLogin(ip[0]).then(async () => {
    const user = await UsersModel.findOne({
      where: {
        [Op.or]: [
          { phone, phone_verify: '0' },
          { phone, phone_verify: '1' },
          { email: phone, email_verify: '1' },
          { email: phone, email_verify: '0' }
        ],
        role_id: 2,
        admin_block: '0'
      },
      attributes: ['id', 'api_token', 'password', 'phone_verify', 'email_verify', 'role_id']
    })

    if (!user) {
      return res.status(status.Forbidden).send({ type: types.error, message: messages[req.userLanguage].auth_fail })
    }

    if (!user.api_token) {
      const salt = Math.random().toString().replace('0.', '')
      const token = bcrypt.hashSync(salt, saltRounds)
      user.api_token = token
      user.last_login = getFiveThirtyPlusDate()
      user.updated_at = getFiveThirtyPlusDate()
      await user.save()
    }

    let r = 0
    if (phone.match(/[a-z]/i)) {
      r = 1
    }

    if (r === 0 && user.phone_verify === '0') {
      const regex = /^\d{10}$/
      const regexResult = regex.test(phone.trim())
      if (!regexResult) {
        return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].mobile_number_validation })
      }
      otpGenerateFunction(phone, 'login', ip).then(() => {
        return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].mob_verify_err, data: { otp_sent: true } })
      }).catch(error => {
        return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage][error] ? messages[req.userLanguage][error] : error })
      })
    } else {
      const hash = user.password
      if (bcrypt.compareSync(password, hash) === true) {
        user.last_login = getFiveThirtyPlusDate()
        await user.save()

        req.body.api_token = user.api_token
        req.body.user_platform = user.platform || 0
        passbookController.mobileLoginBonus(req, res)

        // eslint-disable-next-line eqeqeq
        if (keys.loginOtp && phone != '9924292524') {
          otpGenerateFunction(phone, 'login', ip).then(() => {
            return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].success, data: { otp_sent: true } })
          }).catch(error => {
            return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage][error] ? messages[req.userLanguage][error] : error })
          })
        } else {
          return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].login_succ, data: { api_token: user.api_token, otp_sent: false } })
        }
      } else {
        return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].email_pass_match_err })
      }
    }
    // }).catch(error => {
    //   return res.status(status.OK).send({ type: types.error, message: error })
    // })
  } catch (error) {
    catchError('authController.login', error, req, res)
  }
}

const verifyOTP = async (req, res) => {
  try {
    const { phone_otp, phone: reqPhone, type } = req.body
    const isEmail = reqPhone.match(/[a-z]/i)
    let phone = reqPhone

    if (isEmail) {
      const result = modifyGmailEmail(reqPhone)
      if (!result.success) {
        return res.send({ type: types.error, message: result.message, data: {} })
      }
      phone = result.email
    }

    const mv = await MobileVerificationModel.findOne({
      where: {
        [Op.and]: [
          { mobile_number: phone },
          { mobile_number: { [Op.ne]: '' } },
          { code: phone_otp },
          { code: { [Op.ne]: '' } },
          { is_verify: 'n' },
          { type }
        ]
      }
    })

    if (mv) {
      mv.is_verify = 'y'
      if (type === 'login') {
        const user = await UsersModel.findOne({
          where: {
            [Op.or]: [
              { email: phone },
              { phone }
            ]
          }
        })
        if (!user) return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].auth_fail })

        if (isEmail) {
          user.email_verify = '1'
          user.email_code = ''
        } else if (phone) {
          user.phone_verify = '1'
          user.phone_code = ''
        }
        user.last_login = getFiveThirtyPlusDate()
        await user.save()
        await mv.save()
        return res.send({ type: types.success, message: messages[req.userLanguage].otp_verified_succ, data: { message: 'otp_verified', type: types.success, api_token: user.api_token } })
      } else if (type === 'change') {
        if (!req.headers.authorization) return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].auth_fail })

        const user = await UsersModel.findOne({
          where: { api_token: req.headers.authorization }
        })

        if (!user) return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].auth_fail })
        if (isEmail) {
          user.email_verify = '1'
          user.email_code = ''
        } else if (phone) {
          user.phone_verify = '1'
          user.phone_code = ''
        }
        await user.save()
        await mv.save()
        return res.send({ type: types.success, message: messages[req.userLanguage].otp_verified_succ, data: { message: 'otp_verified', type: types.success, api_token: user.api_token } })
      } else {
        await mv.save()
        return res.send({ type: types.success, message: messages[req.userLanguage].otp_verified_succ, data: { message: 'otp_verified', type: types.success } })
      }
    } else {
      return res.send({ type: types.error, message: messages[req.userLanguage].otp_not_valid, data: { message: 'invalid_otp', type: types.error } })
    }
  } catch (error) {
    catchError('authController.verifyOTP', error, req, res)
  }
}

const resetPassword = async (req, res) => {
  try {
    const { phone, otp, password } = req.body
    const isEmail = phone.match(/[a-z]/i)

    const checkOTP = await MobileVerificationModel.findOne({
      where: {
        is_verify: 'y',
        code: otp,
        mobile_number: phone
      }
    })

    if (!checkOTP) {
      return res.send({ type: types.error, message: messages[req.userLanguage].error_with.replace('##', 'OTP verification') })
    }

    const user = await UsersModel.findOne({
      where: {
        [Op.or]: [
          { email: phone },
          { phone }
        ],
        role_id: 2
      }
    })
    if (!user) return res.send({ type: types.error, message: messages[req.userLanguage].auth_fail, data: {} })

    if (isEmail) {
      user.email_verify = '1'
      user.email_code = ''
    } else if (phone) {
      user.phone_verify = '1'
      user.phone_code = ''
    }
    const hash = bcrypt.hashSync(password, saltRounds)
    user.password = hash
    await user.save()
    checkOTP.is_verify = 'n'
    await checkOTP.save()
    return res.send({ type: types.success, message: messages[req.userLanguage].password_changed })
  } catch (error) {
    catchError('authController.resetPassword', error, req, res)
  }
}

const socialRegisterV2 = async function (req, res) {
  try {
    const { login_with, social_token } = req.body
    const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',') : []

    let email = null
    let sub = null
    if (login_with === 'facebook') {
      const fbRes = await axios.get(`https://graph.facebook.com/v3.2/me?access_token=${social_token}&debug=all&fields=id,name,first_name,last_name,locale,gender,email&format=json&method=get&pretty=1&`)
      email = fbRes.data.email
    } else if (login_with === 'google') {
      const googleRes = await axios.get(`https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${social_token}`)
      email = googleRes.data.email
    } else if (login_with === 'apple') {
      const tokenData = await verifyIdToken(social_token)
      const appleUser = await UsersModel.findOne({
        where: {
          apple_uid: tokenData.sub,
          admin_block: '0',
          role_id: 2
        }
      })

      if (appleUser) {
        req.body.api_token = appleUser.api_token
        req.body.user_platform = appleUser.platform
        passbookController.mobileLoginBonus(req, res)

        return res.send({ type: types.success, message: messages[req.userLanguage].retrieved_success.replace('##', 'Data'), data: { username: appleUser[0].username, api_token: appleUser[0].api_token } })
      }
      email = tokenData.email
      sub = tokenData.sub
    }
    if (!email) return res.send({ type: types.error, message: messages[req.userLanguage].retrieved_success.replace('##', 'Data'), data: { username: '', api_token: '', email, sub } })

    const user = await UsersModel.findOne({
      where: { email, admin_block: '0', role_id: 2 }
    })

    if (!user) {
      return res.send({ type: types.error, message: messages[req.userLanguage].retrieved_success.replace('##', 'Data'), data: { username: '', api_token: '', email, sub } })
    }

    if (!user.api_token) {
      const salt = Math.random().toString().replace('0.', '')
      const token = bcrypt.hashSync(salt, saltRounds)
      user.api_token = token
      user.last_login = getFiveThirtyPlusDate()
      user.updated_at = getFiveThirtyPlusDate()
      await user.save()
    }

    req.body.api_token = user.api_token
    req.body.user_platform = user.platform
    passbookController.mobileLoginBonus(req, res)

    if (keys.loginOtp) {
      otpGenerateFunction(email, 'login', ip).then(() => {
        return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].success, data: { otp_sent: true } })
      }).catch(error => {
        return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage][error] ? messages[req.userLanguage][error] : error })
      })
    } else {
      return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].login_succ, data: { api_token: user.api_token, otp_sent: false } })
    }
  } catch (error) {
    return catchError('userController.socialRegisterNew', error, req, res)
  }
}

const jioLogin = async (req, res) => {
  try {
    const { gamer_id, gamer_name, gamer_avatar_url, device_type } = req.body
    const jioUser = await JioUsersModel.findOne({
      where: { gamer_id },
      include: [{
        model: UsersModel,
        attributes: ['api_token']
      }]
    })

    if (!jioUser) {
      let jioUsername = (gamer_name && gamer_name !== 'null') ? gamer_name.replace(' ', '') : gamer_id.replace(' ', '')
      const isUser = await UsersModel.findOne({ where: { username: jioUsername } })
      if (isUser) {
        jioUsername = await checkUsernameExistence(isUser.username, 1)
      }

      const referCode = crypto.randomBytes(Math.ceil(7 / 2))
        .toString('hex') // convert to hexadecimal format
        .slice(0, 7) // return required number of characters

      const salt = Math.random().toString().replace('0.', '')
      const token = bcrypt.hashSync(salt, 5)
      console.log({ referCode })
      const currentTime = getFiveThirtyPlusDate()
      console.log({ currentTime })

      const userData = {
        name: gamer_name,
        username: jioUsername,
        email: `${jioUsername}@jio.com`,
        email_verify: '1',
        phone_verify: '1',
        role_id: 2,
        updated_at: currentTime,
        created_at: currentTime,
        api_token: token,
        my_refer_code: referCode
      }

      const newUser = await UsersModel.create(userData)
      const jioUserData = {
        gamer_id,
        gamer_name,
        user_id: newUser.id,
        gamer_avatar_url,
        updated_at: currentTime,
        created_at: currentTime
      }
      if (device_type.trim()) jioUserData.device_type = device_type
      console.log({ jioUserData })
      await JioUsersModel.create(jioUserData)
      return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].login_succ, data: { api_token: newUser.api_token, otp_sent: false } })
    }
    return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].login_succ, data: { api_token: jioUser.user.api_token, otp_sent: false } })
  } catch (error) {
    catchError('authController.jioLogin', error, req, res)
  }
}

module.exports = {
  sendOtpUser,
  login,
  verifyOTP,
  resetPassword,
  socialRegisterV2,
  jioLogin
}
