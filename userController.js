/* eslint-disable no-useless-escape */
/* eslint-disable camelcase */
const Sequelize = require('sequelize')
const { Op, col, literal } = require('sequelize')
const { validationResult } = require('express-validator/check')
const bcrypt = require('bcrypt')
const axios = require('axios')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const moment = require('moment')
const mongoose = require('mongoose')
var AWS = require('aws-sdk')
var cfSdk  = require('cashfree-sdk')
const Notifications = require('../models/notifications.model')
const keys = require('../config/keys')
const { sendmail, pick, removenull, modifyGmailEmail } = require('../config/helpers')
const passbookController = require('../controllers/passbookController')
const { messages, status, catchError, types, getFiveThirtyPlusDate, checkRateLimitEmail, checkRateLimitLogin, checkRateLimitRegistration, multiVersions } = require('../api.response')
const util = require('util');
const { redisClient2, queuePush } = require('./../services/memoryCache')
const { verifyIdToken } = require('./appleLoginController')
const { sendOtp, verifyPhoneOtp, sendOtpBangla } = require('./utilitiesController')
const {
  sequelize,
  models: {
    users: UsersModel,
    cities: CitiesModel,
    states: StatesModel,
    passbooks: PassbooksModel,
    user_leagues: UserLeaguesModel,
    roles: RolesModel,
    mobile_verification: MobileVerificationModel,
    user_payment_methods: UserPaymentMethodModel,
    validations: ValidationModel
  }
} = require('./../services/sqlConnect')
const { exit } = require('process')

const saltRounds = 10

const Schema = new mongoose.Schema({}, { strict: false })
const failedLogins = mongoose.model('bruteforceloginns', Schema)

AWS.config.update({ accessKeyId: keys.awsAccessKey, secretAccessKey: keys.awsAccessSecret, signatureVersion: 'v4', region: 'ap-south-1' })
var s3 = new AWS.S3()

const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: {
    user: keys.multiVersions === 'bangla' ? keys.sandGridUserBangla : keys.sandGridUser,
    pass: keys.multiVersions === 'bangla' ? keys.sandGridPassBangla : keys.sandGridPass
  }
})

const editProfile = async function (req, res) { // done
  let {
    my_address,
    user_name,
    gender,
    city,
    pin,
    dob
  } = req.body

  my_address = my_address.replace(/(<([^>]+)>)/ig, '')
  user_name = user_name.replace(/(<([^>]+)>)/ig, '')

  await UsersModel.update(
    {
      name: user_name,
      gender,
      city_id: city,
      address: my_address,
      pin,
      dob
    },
    { where: { id: req.user.id } }
  )
  return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Profile') })
}

const myProfileV2 = async function (req, res) { // done
  try {
    let user = await UsersModel.findOne({
      where: { id: req.user.id },
      include: [{
        model: CitiesModel,
        attributes: [],
        include: [{
          model: StatesModel,
          attributes: ['country_id']
        }]
      }],
      attributes: ['id', 'name', 'username', 'email', 'email_verify', 'phone', 'phone_verify', 'gender', 'city_id', 'address', 'pin', 'dob', [col('city.state_id'), 'state_id'], [col('city->state.country_id'), 'country_id']]
    })

    const isDeposit = await PassbooksModel.count({
      where: {
        user_id: req.user.id,
        particular: 'Deposit',
        order_status: 'Complete',
        parent_id: {
          [Op.ne]: null
        }
      }
    })

    const isJoinLeague = await UserLeaguesModel.count({
      where: {
        user_id: req.user.id
      }
    })
    user = user.toJSON()
    user.isDeposite = isDeposit > 0 ? 1 : 0
    user.isJoinLeague = isJoinLeague > 0 ? 1 : 0

    return res.send({
      type: types.success,
      message: messages[req.userLanguage].fetched_succ.replace('##', 'data'),
      data: { users: [user] }
    })
  } catch (error) {
    return catchError('userController.myProfileV2', error, req, res)
  }
}

// const editBankInfo = async function (req, res) { // done
//   try {
//     let { branch_name, bank_name, bank_ac_name, ac_no, ifsc } = req.body
//     branch_name = branch_name.replace(/(<([^>]+)>)/ig, '')
//     bank_name = bank_name.replace(/(<([^>]+)>)/ig, '')
//     bank_name = bank_name + '-' + branch_name
//     bank_ac_name = bank_ac_name.replace(/(<([^>]+)>)/ig, '')
//     ac_no = ac_no.replace(/(<([^>]+)>)/ig, '')
//     ifsc = ifsc.replace(/(<([^>]+)>)/ig, '')

//     // ===============================Ajay Kumar 09/11/2022============================================
//      const bankAcExist = await UsersModel.findOne({
//       where: { bank_account_no: ac_no },
//       attributes: ['id']
//     })
//     if (bankAcExist) {
//       return res.send({ type: types.error, message: messages[req.userLanguage].bank_ac_exists })
//     }
//     // ===================================End============================================================
//     //===================================Cashfree Api Varification Suite=================================
//     // ---------------------------------------Authorization Bearer Token----------------------
//       const myObj = await axios({
//         method: 'post',
//         url: 'https://payout-api.cashfree.com/payout/v1/authorize',
//         headers: {
//           accept: 'application/json',
//           'X-Cf-Signature': keys.cashfree_vssuite_signature,
//           'X-Client-Secret': keys.cashfree_vssuite_secret_id,
//           'X-Client-Id': keys.cashfree_vssuite_client_id
//         }
//       })
//       const ob_j = myObj.data;
//       // ---------------------------------------Authorization Bearer Token----------------------
//       const bank_response = await axios({
//           method: 'GET',
//           url: `https://payout-api.cashfree.com/payout/v1/asyncValidation/bankDetails?name=${bank_ac_name}&phone=8349102770&bankAccount=${ac_no}&ifsc=${ifsc}&remarks=Bank A/C Verification`,
//           headers: {
//             accept: 'application/json',
//             Authorization: 'Bearer '+ob_j.data.token,
//             'Content-Type': 'application/json'
//           }
//         })
//         // =========================================
//         // myObj.self = bank_response;
//         const val_data = bank_response.data;
//         // console.log('in line no. 248 options...'+ util.inspect(myObj, { showHidden: false, depth: null }));
//         if (val_data.data != '' || val_data.data != null || val_data.data != 'undefined' || val_data.data != undefined) {
//           const verification_status = await axios({
//             method: 'GET',
//             url: `https://payout-api.cashfree.com/payout/v1/getValidationStatus/bank?bvRefId=${val_data.data.bvRefId}&userId=fsdfsd`,
//             headers: {
//               accept: 'application/json',
//               Authorization: 'Bearer '+ob_j.data.token,
//               'Content-Type': 'application/json'
//             }
//           })
//           const verification_data = verification_status.data;
//           if(verification_data.status == 'SUCCESSS' && verification_data.subCode == '200'){
//               const results = await UsersModel.update(
//                 {
//                   bank_name,
//                   bank_account_name: bank_ac_name,
//                   bank_account_no: ac_no,
//                   ifsc,
//                   bank_change_approval: '1'
//                 },
//                 {
//                   where: {
//                     id: req.user.id,
//                     name: bank_ac_name
//                   }
//                 }
//               )
//               if (results[0]) {
//                 return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Bank details') })
//               } else {
//                 return res.send({ type: types.error, message: messages[req.userLanguage].profile_acc_name_err })
//               }
//           }else{
//             return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
//           }
//         } else {
//           return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
//         }
//     //===================================Cashfree Api Varification Suite================================= 
//   } catch (error) {
//     return catchError('userController.editBankInfo', error, req, res)
//   }
// }


const editBankInfoFinal = async function (req, res) { 
  try {
    let { branch_name, bank_name, bank_ac_name, ac_no, ifsc } = req.body
    branch_name = branch_name.replace(/(<([^>]+)>)/ig, '')
    bank_name = bank_name.replace(/(<([^>]+)>)/ig, '')
    bank_namek = bank_name.replace(/(<([^>]+)>)/ig, '')
    if (bank_name == 'Paytm Payments Bank' || bank_name == 'PAYTM PAYMENTS BANK' || bank_name == 'paytm payments bank' || bank_name == 'Paytm Payment Bank' || bank_name == 'PAYTM PAYMENT BANK' || bank_name == 'paytm payment bank' || bank_name == 'pytm' || bank_name == 'paytm' || bank_name == 'PYTM' || bank_name == 'PAYTM' || bank_name == 'Paytm' || bank_name == 'Pytm') {
      return res.send({ type: types.error, message: 'Paytm Payments Bank disassociated. Provide updated banking information.' })
    }
    bank_name = bank_name + '-' + branch_name
    bank_ac_name = bank_ac_name.replace(/(<([^>]+)>)/ig, '')
    ac_no = ac_no.replace(/(<([^>]+)>)/ig, '')
    ifsc = ifsc.replace(/(<([^>]+)>)/ig, '')
    if (ifsc == 'PYTM0123456' || ifsc == 'pytm0123456' || ifsc == 'Pytm0123456' || ifsc == 'pytm' || ifsc == 'paytm' || ifsc == 'PYTM' || ifsc == 'PAYTM' || ifsc == 'Paytm' || ifsc == 'Pytm') {
      return res.send({ type: types.error, message: 'Paytm Payments Bank disassociated. Provide updated banking information.' })
    }

 
    const bankAcExist = await UsersModel.findOne({
      where: { bank_account_no: ac_no },
      attributes: ['id']
    })

    if (bankAcExist) {
      return res.send({ type: types.error, message: messages[req.userLanguage].bank_ac_exists })
    }

    const find_data = await UsersModel.findOne({ _id: req.user.id });
    const user_id = req.user.id;
    const phone_no = find_data.phone;

    console.log(phone_no)

    const myObj = await axios({
      method: 'post',
      url: 'https://payout-api.cashfree.com/payout/v1/authorize',
      headers: {
        accept: 'application/json',
        'X-Cf-Signature': 'W1Mu2dRomOKuoES0ITecD0pyFtcrWyEbCnoPaPHX3tFgl4TBHkh6GLXZhk+RF+gFZAfSzH2IhflFsTl6+XbO3OKE7MPa5yb6jz5fcJSJuXWjUKRJ9PmcC3qt2BM4e1r00ROxwmvT52WjvA1g54kig/AXaTRHmbRczJLwe6MurVEIhQJvzaehRGcuOa61fOlx2L3h5f5Q4WPmyLOhHM6C3BtmZNor2TsV3ISHQu3gMXhAmci6/Q3kHeGQFC0yj+OSbftioExSn98Ki5CA/lhJYCVho8riWcigrJcZg9PubpQ+QVAD4JjpC9cRZsCibxoF9EEu/Y8X0s+VghN+RyTSSQ==',
        'X-Client-Secret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
        'X-Client-Id': 'CF2401CFNHK2OD0OAH85U13SK0'
      }
    });
    const ob_j = myObj.data;

    const bank_response = await axios({
      method: 'GET',
      url: `https://payout-api.cashfree.com/payout/v1/asyncValidation/bankDetails?bankAccount=${ac_no}&ifsc=${ifsc}&name=${bank_ac_name}&phone=${phone_no}`, 
      headers: {
        accept: 'application/json',
        Authorization: 'Bearer ' + ob_j.data.token,
        'Content-Type': 'application/json'
      }
    });

    const val_data = bank_response.data;
    if (val_data.subCode === '422') {
      return res.send({ type: types.error, message: messages[req.userLanguage].bank_verify_err }) 
    }else{  
      try {
        const c_user_id = req.user.id;
        const c_bvRefId = val_data.data.bvRefId;

        const verification_status = await axios({
          method: 'GET',
          url: `https://payout-api.cashfree.com/payout/v1/getValidationStatus/bank?bvRefId=${c_bvRefId}`,
         
          headers: {
            accept: 'application/json',
            Authorization: 'Bearer ' + ob_j.data.token,
            'Content-Type': 'application/json'
          }
        });

        const verification_data = verification_status.data;
        console.log("eeeeeeeeeeee") 
        console.log(verification_data)
        console.log("eeeeeeffeeeeee")

        if (verification_data.status === 'SUCCESS') {
          const results = await UsersModel.update(
            {
              bank_name,
              bank_account_name: bank_ac_name,
              bank_account_no: ac_no,
              ifsc,
              bank_change_approval: '1'
            },
            {
              where: {
                id: req.user.id,
                name: bank_ac_name
              }
            }
          );

          if (results[0]) {
            return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Bank details') });
          } else {
            return res.send({ type: types.error, message: messages[req.userLanguage].profile_acc_name_err });
          }
        } else {
          return res.status(status.BadRequest).json({ type: types.error, message: messages[req.userLanguage].error });
        }
      } catch (error) {
        console.error(error);
        return res.status(status.InternalServerError).json({ type: types.error, message: messages[req.userLanguage].error });
      }
    } 
  } catch (error) {
    return catchError('userController.editBankInfo', error, req, res);
  }
}






const editBankInfo = async function (req, res) { 
  try {
    let { branch_name, bank_name, bank_ac_name, ac_no, ifsc } = req.body
    branch_name = branch_name.replace(/(<([^>]+)>)/ig, '')
    bank_name = bank_name.replace(/(<([^>]+)>)/ig, '')
    bank_namek = bank_name.replace(/(<([^>]+)>)/ig, '')
    if (bank_name == 'Paytm Payments Bank' || bank_name == 'PAYTM PAYMENTS BANK' || bank_name == 'paytm payments bank' || bank_name == 'Paytm Payment Bank' || bank_name == 'PAYTM PAYMENT BANK' || bank_name == 'paytm payment bank' || bank_name == 'pytm' || bank_name == 'paytm' || bank_name == 'PYTM' || bank_name == 'PAYTM' || bank_name == 'Paytm' || bank_name == 'Pytm') {
      return res.send({ type: types.error, message: 'Paytm Payments Bank disassociated. Provide updated banking information.' })
    }
    bank_name = bank_name + '-' + branch_name
    bank_ac_name = bank_ac_name.replace(/(<([^>]+)>)/ig, '')
    ac_no = ac_no.replace(/(<([^>]+)>)/ig, '')
    ifsc = ifsc.replace(/(<([^>]+)>)/ig, '')
    if (ifsc == 'PYTM0123456' || ifsc == 'pytm0123456' || ifsc == 'Pytm0123456' || ifsc == 'pytm' || ifsc == 'paytm' || ifsc == 'PYTM' || ifsc == 'PAYTM' || ifsc == 'Paytm' || ifsc == 'Pytm') {
      return res.send({ type: types.error, message: 'Paytm Payments Bank disassociated. Provide updated banking information.' })
    }

 
    const bankAcExist = await UsersModel.findOne({
      where: { bank_account_no: ac_no },
      attributes: ['id']
    })

    if (bankAcExist) {
      return res.send({ type: types.error, message: messages[req.userLanguage].bank_ac_exists })
    }

    const find_data = await UsersModel.findOne({ _id: req.user.id });
    const user_id = req.user.id;
    const phone_no = find_data.phone;

    const myObj = await axios({
      method: 'post',
      url: 'https://payout-api.cashfree.com/payout/v1/authorize',
      headers: {
        accept: 'application/json',
        'X-Cf-Signature': 'W1Mu2dRomOKuoES0ITecD0pyFtcrWyEbCnoPaPHX3tFgl4TBHkh6GLXZhk+RF+gFZAfSzH2IhflFsTl6+XbO3OKE7MPa5yb6jz5fcJSJuXWjUKRJ9PmcC3qt2BM4e1r00ROxwmvT52WjvA1g54kig/AXaTRHmbRczJLwe6MurVEIhQJvzaehRGcuOa61fOlx2L3h5f5Q4WPmyLOhHM6C3BtmZNor2TsV3ISHQu3gMXhAmci6/Q3kHeGQFC0yj+OSbftioExSn98Ki5CA/lhJYCVho8riWcigrJcZg9PubpQ+QVAD4JjpC9cRZsCibxoF9EEu/Y8X0s+VghN+RyTSSQ==',
        'X-Client-Secret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
        'X-Client-Id': 'CF2401CFNHK2OD0OAH85U13SK0'
      }
    });
    const ob_j = myObj.data;

    const bank_response = await axios({
      method: 'GET',
      url: `https://payout-api.cashfree.com/payout/v1/asyncValidation/bankDetails?bankAccount=${ac_no}&ifsc=${ifsc}&name=${bank_ac_name}&phone=${phone_no}`, 
      headers: {
        accept: 'application/json',
        Authorization: 'Bearer ' + ob_j.data.token,
        'Content-Type': 'application/json'
      }
    });

    const val_data = bank_response.data;
    if (val_data.subCode === '422') {
      return res.send({ type: types.error, message: messages[req.userLanguage].bank_verify_err }) 
    }else{  
      try {
        setTimeout(async () => {
          try {
            const c_userId = req.user.id;
            const c_bvRefId = val_data.data.bvRefId;

            const verification_status = await axios({
              method: 'GET',
              url: `https://payout-api.cashfree.com/payout/v1/getValidationStatus/bank?bvRefId=${c_bvRefId}`,
             
              headers: {
                accept: 'application/json',
                Authorization: 'Bearer ' + ob_j.data.token,
                'Content-Type': 'application/json'
              }
            });
    
            const verification_data = verification_status.data;
            if (verification_data.data.accountExists === 'YES') {
              const results = await UsersModel.update(
                {
                  bank_name,
                  bank_account_name: bank_ac_name,
                  bank_account_no: ac_no,
                  ifsc,
                  bank_change_approval: '1'
                },
                {
                  where: {
                    id: req.user.id,
                    name: bank_ac_name
                  }
                }
              );
    
              if (results[0]) {
                return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Bank details') });
              } else {
                return res.send({ type: types.error, message: messages[req.userLanguage].profile_acc_name_err });
              }
            } else {
              console.log('..test line number 1');
              //return res.status(status.BadRequest).json({ type: types.error, message: messages[req.userLanguage].error });
              return res.send({ type: types.error, message: messages[req.userLanguage].bank_verify_err }) 
            }

          } catch (error) {
            console.log('..test line number 2');
            return res.send({ type: types.error, message: messages[req.userLanguage].bank_verify_err }) 
          }
        }, 5000);

      } catch (error) {
        console.log('..test line number 3');
        return res.status(status.InternalServerError).json({ type: types.error, message: messages[req.userLanguage].error });
      }
    } 
  } catch (error) {
    console.log('..test line number 4');
    return catchError('userController.editBankInfo', error, req, res);
  }
}








const editBankInfo_bkup = async function (req, res) { // done
  try {
    console.log(`in editBankInfo line 219.......`);
    let { branch_name, bank_name, bank_ac_name, ac_no, ifsc } = req.body;
    branch_name = branch_name.replace(/(<([^>]+)>)/ig, '');
    bank_name = bank_name.replace(/(<([^>]+)>)/ig, '');

    const forbiddenBankNames = [
      'Paytm Payments Bank',
      'PAYTM PAYMENTS BANK',
      'paytm payments bank',
      'Paytm Payment Bank',
      'PAYTM PAYMENT BANK',
      'paytm payment bank',
      'pytm',
      'paytm',
      'PYTM',
      'PAYTM',
      'Paytm',
      'Pytm'
    ];

    if (forbiddenBankNames.includes(bank_name)) {
      return res.send({ type: types.error, message: 'Paytm Payments Bank disassociated. Provide updated banking information.' });
    }

    bank_name = bank_name + '-' + branch_name;
    bank_ac_name = bank_ac_name.replace(/(<([^>]+)>)/ig, '');
    ac_no = ac_no.replace(/(<([^>]+)>)/ig, '');
    ifsc = ifsc.replace(/(<([^>]+)>)/ig, '');

    const forbiddenIfscCodes = [
      'PYTM0123456',
      'pytm0123456',
      'Pytm0123456',
      'pytm',
      'paytm',
      'PYTM',
      'PAYTM',
      'Paytm',
      'Pytm'
    ];

    if (forbiddenIfscCodes.includes(ifsc)) {
      return res.send({ type: types.error, message: 'Paytm Payments Bank disassociated. Provide updated banking information.' });
    }

    const bankAcExist = await UsersModel.findOne({
      where: { bank_account_no: ac_no },
      attributes: ['id']
    });

    console.log(`in editBankInfo line 239.......`);
    if (bankAcExist) {
      return res.send({ type: types.error, message: messages[req.userLanguage].bank_ac_exists });
    }

    const find_data = await UsersModel.findOne({ _id: 1216035 });
    const user_id = 1216035;
    const phone_no = find_data.phone;
    console.log(`in editBankInfo line 248.......`);

    const myObj = await axios({
      method: 'post',
      url: 'https://payout-api.cashfree.com/payout/v1/authorize',
      headers: {
        accept: 'application/json',
        'X-Cf-Signature': 'W1Mu2dRomOKuoES0ITecD0pyFtcrWyEbCnoPaPHX3tFgl4TBHkh6GLXZhk+RF+gFZAfSzH2IhflFsTl6+XbO3OKE7MPa5yb6jz5fcJSJuXWjUKRJ9PmcC3qt2BM4e1r00ROxwmvT52WjvA1g54kig/AXaTRHmbRczJLwe6MurVEIhQJvzaehRGcuOa61fOlx2L3h5f5Q4WPmyLOhHM6C3BtmZNor2TsV3ISHQu3gMXhAmci6/Q3kHeGQFC0yj+OSbftioExSn98Ki5CA/lhJYCVho8riWcigrJcZg9PubpQ+QVAD4JjpC9cRZsCibxoF9EEu/Y8X0s+VghN+RyTSSQ==',
        'X-Client-Secret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
        'X-Client-Id': 'CF2401CFNHK2OD0OAH85U13SK0'
      }
    });

    const ob_j = myObj.data;
    console.log(`in editBankInfo line 263.......`);
    console.log(myObj.data);

    const bank_response = await axios({
      method: 'GET',
      url: `https://payout-api.cashfree.com/payout/v1/asyncValidation/bankDetails?name=${bank_ac_name}&phone=${phone_no}&bankAccount=${ac_no}&ifsc=${ifsc}&remarks=Bank A/C Verification?userId=${user_id}`,
      headers: {
        accept: 'application/json',
        Authorization: 'Bearer ' + ob_j.data.token,
        'Content-Type': 'application/json'
      }
    });

    const val_data = bank_response.data;
    

    //const c_user_id = 'W3698521';
    

    if (val_data.subCode === '422') {
      console.log("...LINE NUMBER 317");
      //return res.status(status.BadRequest).json({ type: types.error, message: messages[req.userLanguage].error });
      return res.send({ type: types.error, message: messages[req.userLanguage].bank_verify_err }) 
    }else{  
      try {
        const c_user_id = '1216035';
        const c_bvRefId = val_data.data.bvRefId;

        console.log("...indra Line number 324...");
        console.log(c_bvRefId);
        console.log("...indra Line number 326...");

        const verification_status = await axios({
          method: 'GET',
          url: `https://payout-api.cashfree.com/payout/v1/getValidationStatus/bank?bvRefId=${c_bvRefId}`,
         
          headers: {
            accept: 'application/json',
            Authorization: 'Bearer ' + ob_j.data.token,
            'Content-Type': 'application/json'
          }
        });

        const verification_data = verification_status.data;
        console.log('in line 337....');
        console.log(verification_data);
        console.log('in line 339....');
       // console.log(`in line 290.... ${verification_data.subCode}`);
        console.log(`in line 291.... ${verification_data.status}`);
        //console.log(`in line 291.... ${JSON.stringify(verification_data)}`);

        if (verification_data.status === 'SUCCESS') {
          console.log('nnn in line 345....');
          const results = await UsersModel.update(
            {
              bank_name,
              bank_account_name: bank_ac_name,
              bank_account_no: ac_no,
              ifsc,
              bank_change_approval: '1'
            },
            {
              where: {
                id: req.user.id,
                bank_account_name: bank_ac_name
              }
            }
          );
           
          console.log('nnn in line 362....');
          

          if (results[0]) {
            return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Bank details') });
          } else {
            return res.send({ type: types.error, message: messages[req.userLanguage].profile_acc_name_err });
          }
        } else {
          return res.status(status.BadRequest).json({ type: types.error, message: messages[req.userLanguage].error });
        }
      } catch (error) {
        console.error(error);
        return res.status(status.InternalServerError).json({ type: types.error, message: messages[req.userLanguage].error });
      }
    } 
  } catch (error) {
    return catchError('userController.editBankInfo', error, req, res);
  }
}





const editPhone = async function (req, res) { // done
  try {
    const { api_token, phone } = req.body

    if (api_token) {
      const user = await UsersModel.findOne({
        where: { api_token, role_id: 2 }
      })

      if (!user) {
        return res.send({ type: types.error, message: messages[req.userLanguage].auth_fail, data: {} })
      }

      const regex = /^\d{10}$/
      const regexResult = regex.test(phone.trim())
      if (!regexResult) {
        return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].mobile_number_validation })
      }

      const phone_code = Math.floor(100000 + Math.random() * 900000)

      user.phone = phone
      user.phone_verify = '0'
      user.phone_code = phone_code

      await user.save()

      await redisClient2.del(`at:${api_token}`)
      if (keys.multiVersions !== 'bangla') {
        sendOtp(phone, phone_code).then(() => {
          return res.send({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'OTP') })
        }).catch(error => {
          console.log(error)
          return res.send({ type: types.error, message: messages[req.userLanguage].error, data: error.response && error.response.data })
        })
      } else {
        const result = await sendOtpBangla(phone, phone_code)
        if (!result) {
          return res.send({ type: types.error, message: messages[req.userLanguage].error })
        }
        return res.send({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'OTP') })
      }
    } else {
      let user = await UsersModel.findOne({
        where: { phone, role_id: 2 },
        attributes: ['id', 'api_token', 'role_id']
      })

      if (!user) return res.send({ type: types.error, message: messages[req.userLanguage].auth_fail, data: {} })

      const phone_code = Math.floor(100000 + Math.random() * 900000)

      if (keys.multiVersions !== 'bangla') {
        sendOtp(phone, phone_code).then(async (response) => {
          user.phone_verify = '0'
          user.phone_code = phone_code
          await user.save()
          user = user.toJSON()
          delete user.phone_code
          delete user.phone_verify
          await redisClient2.del(`at:${api_token}`)
          return res.send({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'OTP'), data: [user] })
        }).catch(error => {
          console.log({ error })
          return res.send({ type: types.error, message: messages[req.userLanguage].error, data: error.response && error.response.data })
        })
      } else {
        const result = await sendOtpBangla(phone, phone_code)
        if (!result) {
          return res.send({ type: types.error, message: messages[req.userLanguage].error })
        }
        user.phone_verify = '0'
        user.phone_code = phone_code
        await user.save()
        user = user.toJSON()
        delete user.phone_code
        delete user.phone_verify
        await redisClient2.del(`at:${api_token}`)
        return res.send({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'OTP'), data: [user] })
      }
    }
  } catch (error) {
    return catchError('userController.editPhone', error, req, res)
  }
}

const verifyOtp = async function (req, res) { // done
  try {
    let { api_token, otp, phone } = req.body

    const user = await UsersModel.findOne({
      where: { api_token },
      attributes: ['id', 'api_token', 'first_login', 'last_login', 'phone']
    })

    if (!user) return res.send({ type: types.error, message: messages[req.userLanguage].auth_fail, data: user })
    if (!phone) phone = user.phone
    const current_date_time = getFiveThirtyPlusDate()

    const otpRes = await verifyPhoneOtp(phone, otp)

    if (otpRes.data.type === 'success') {
      user.phone_verify = '1'
      user.phone = phone
      user.phone_code = ''
      user.last_login = current_date_time

      if (user.first_login == null) {
        user.first_login = current_date_time
      }

      await user.save()
      await redisClient2.del(`at:${api_token}`)

      return res.send({ type: types.success, message: messages[req.userLanguage].mob_verify_succ })
    } else if (otpRes.data.type === 'error' || otpRes.data.message === 'mobile_not_found' || otpRes.data.message === 'invalid_auth_key') {
      if (otpRes.data.message === 'already_verified') {
        return res.send({ type: types.error, message: messages[req.userLanguage].mob_verified })
      } else if (otpRes.data.message === 'invalid_otp' || otpRes.data.message === 'otp_not_verified') {
        return res.send({ type: types.error, message: messages[req.userLanguage].otp_not_valid })
      } else if (otpRes.data.message === 'otp_expired') {
        return res.send({ type: types.error, message: messages[req.userLanguage].otp_expired })
      } else {
        return res.send({ type: types.error, message: messages[req.userLanguage].error })
      }
    } else {
      return res.send({ type: types.error, message: messages[req.userLanguage].error })
    }
  } catch (error) {
    return catchError('userController.verifyOtp', error, req, res)
  }
}

const changePassword = async function (req, res) { // done
  try {
    const hash = bcrypt.hashSync(req.body.password, saltRounds)
    await UsersModel.update({ password: hash }, { where: { id: req.user.id } })
    return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Password') })
  } catch (error) {
    return catchError('userController.changePassword', error, req, res)
  }
}

const register = async function (req, res) {
  try {
    let { email, phone, username, password, affiliate_field, login_with, uid, social_token, user_name, utm_offer = '', utm_pid = '' } = req.body
    const ip = req.headers['x-forwarded-for'].split(',')
    username = username.toLowerCase()
    email = (email) ? email.toLowerCase() : null
    if (keys.multiVersions !== 'bangla' && !email) {
      return res.send({ type: types.error, message: 'Email is required' })
    }
    if (email) {
      const result = modifyGmailEmail(email)
      if (!result.success) {
        return res.send({ type: types.error, message: result.message, data: {} })
      }
      email = result.email
    }
    checkRateLimitRegistration(ip).then(async () => {
      let queryData
      if (email) {
        queryData = [
          { email },
          { phone: phone.toString() },
          { username }
        ]
      } else {
        if (keys.multiVersions !== 'bangla') {
          return res.send({ type: types.error, message: 'Email is required', data: {} })
        }
        queryData = [
          { phone: phone.toString() },
          { username }
        ]
      }
      const user = await UsersModel.findOne({
        where: {
          [Op.or]: queryData
        }
      })

      if (user) {
        return res.send({ type: types.error, message: messages[req.userLanguage].already_register, data: user })
      } else {
        const role = await RolesModel.findOne({
          where: { name: 'User' },
          raw: true,
          cache: true,
          expire: 500
        })
        if (role) {
          const roleID = role.id

          const hash = bcrypt.hashSync(password, saltRounds)
          const phone_code = Math.floor(100000 + Math.random() * 900000)
          const email_code = Math.floor(100000 + Math.random() * 900000)
          const salt = Math.random().toString().replace('0.', '')
          const token = bcrypt.hashSync(salt, saltRounds)

          const len = 7
          const my_refer_code = crypto.randomBytes(Math.ceil(len / 2))
            .toString('hex') // convert to hexadecimal format
            .slice(0, len) // return required number of characters

          let affiliate = ''
          if (affiliate_field) {
            affiliate = affiliate_field
          }

          let g_id = ''
          // let g_token = ''
          let fb_id = ''
          let fb_token = ''
          let apple_uid = ''
          let email_verify = '0'
          const phone_verify = '1'
          if (login_with) {
            if (login_with === 'google') {
              email_verify = '1'
              g_id = uid
              // g_token = social_token
            }
            if (login_with === 'facebook') {
              email_verify = '1'
              fb_id = uid
              fb_token = social_token
            }
            if (login_with === 'apple') {
              email_verify = '1'
              apple_uid = uid
            }
          }

          const current_date_time = getFiveThirtyPlusDate()
          const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress

          let platform = req.body.platform || req.params.platform || req.query.platform
          if (platform && !['0', '1', '2', '3'].includes(platform)) {
            platform = null
          }

          const checkOTP = await MobileVerificationModel.findOne({
            where: {
              is_verify: 'y',
              mobile_number: phone
            },
            raw: true
          })

          if (!checkOTP) {
            return res.send({ type: types.error, message: messages[req.userLanguage].error_with.replace('##', 'OTP verification') })
          }

          if (keys.multiVersions !== 'bangla') {
            const msgVerify = await verifyPhoneOtp(phone, checkOTP.code)

            if (msgVerify.data.type === 'error') {
              return res.send({ type: types.error, message: messages[req.userLanguage].error_with.replace('##', 'OTP verification') })
            }
          }

          const results = await UsersModel.create({
            name: user_name,
            platform,
            username,
            email,
            email_verify,
            phone,
            phone_verify,
            password: hash,
            email_code,
            phone_code,
            role_id: roleID,
            created_at: current_date_time,
            updated_at: current_date_time,
            api_token: token,
            affiliate_field: affiliate,
            google_uid: g_id,
            google_access_token: '',
            fb_uid: fb_id,
            fb_access_token: fb_token,
            apple_uid,
            my_refer_code,
            ipaddress: ip
          })

          affiliate = ''
          let campaignName = ''
          if (affiliate_field) {
            affiliate = affiliate_field
            const array1 = affiliate.split('-')
            campaignName = array1[0]
            const MediumId = array1[array1.length - 2]
            let transactionId = array1[array1.length - 1]
            transactionId = transactionId.replace('|', '-')

            if (campaignName && transactionId) {
              const url123 = 'https://www.countrypoker.com/register/affiliate?_token=' + token + '&api_login=affiliatetest&api_password=affiliatetest&user_id=' + results[0] + '&username=' + username + '&email=' + email + '&phone=' + phone + '&utm_source=' + campaignName + '&utm_medium=' + MediumId + '&utm_campaign=' + transactionId + '&utm_website=11wickets&utm_pid=' + utm_pid + '&utm_offer=' + utm_offer

              axios.get(url123)
                .then()
                .catch(error => console.log(error.response ? error.response.data : 'userController.register'))

              if (campaignName === 'opicle' || campaignName === 'click2commission' || campaignName === 'maadme' || campaignName === 'shisamdigital' || campaignName === 'svgcolumbus' || campaignName === 'adsterra' || campaignName === 'adcounty') {
                UsersModel.findOne({
                  affiliate_verify: '1',
                  updated_at: current_date_time
                }, {
                  api_token: token
                })
                  .then()
                  .catch()
              }
            }
          }

          req.body.api_token = token
          passbookController.registerBonus(req, res)

          if (email) {
            checkRateLimitEmail(email).then(() => {
              const baseUrl = keys.multiVersions === 'bangla' ? 'https://www.11wickets.com.bd' : 'https://www.11wickets.com'
              const contentObj = {
                from: keys.multiVersions === 'bangla' ? keys.mailgunFromBangla : keys.mailgunFrom,
                subject: '11Wickets email verification code',
                html: `<!DOCTYPE html> <html> <head> <title>11wicket</title> </head> <body> <div style="text-align:center"> <a href="${baseUrl}/"><img src="${baseUrl}/img/logo.png" alt="11wicket" style="max-width: 250px;display:inline-block;" /></a> <hr style="border:2px solid #43b4ae;"> </div> <div> <strong style="font-size:18px;">Hello ${req.body.email},</strong><br><br> <p>Thank you for registering with us.<br/><br> <strong>Please activate your account using the below code.</strong></p> </div> <div style="text-align:center"> <a href="#" style="padding: 15px 30px; background: #43b4ae; color: #ffffff; margin-top: 30px; display: inline-block; border-radius: 5px;"> ${email_code} </a> </div> <div style="font-size:15px;"> Thank you,<br> <a href="${baseUrl}/">11wicket Support Team</a> </div> </body> </html>`,
                to: email
              }
              transporter.sendMail(contentObj, function (error) {
                console.log(error)
              })
              return res.send({ type: types.success, message: messages[req.userLanguage].action_success.replace('##', 'Registration'), data: { api_token: token, affiliate: campaignName, user_id: results[0] } })
            }).catch(error => {
              console.log('register', error)
              return res.send({ type: types.success, message: messages[req.userLanguage].action_success.replace('##', 'Registration'), data: { api_token: token, affiliate: campaignName, user_id: results[0] } })
            })
          } else {
            return res.send({ type: types.success, message: messages[req.userLanguage].action_success.replace('##', 'Registration'), data: { api_token: token, affiliate: campaignName, user_id: results[0] } })
          }
        } else {
          return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'Role'), data: role })
        }
      }
    }).catch(error => {
      console.log('register', error)
      return res.status(status.OK).send({ type: types.error, message: error })
    })
  } catch (error) {
    return catchError('userController.register', error, req, res)
  }
}

const registerV2 = async function (req, res) {
  try {
    let { email, phone, username, password, affiliate_field, login_with, uid, social_token, user_name, utm_offer = '', utm_pid = '', city } = req.body
    const ip = req.headers['x-forwarded-for'].split(',')
    username = username.toLowerCase()
    email = (email) ? email.toLowerCase() : null
    if (keys.multiVersions !== 'bangla' && !email) {
      return res.send({ type: types.error, message: 'Email is required' })
    }
    if (email) {
      const result = modifyGmailEmail(email)
      if (!result.success) {
        return res.send({ type: types.error, message: result.message, data: {} })
      }
      email = result.email
    }
    checkRateLimitRegistration(ip).then(async () => {
      let queryData
      if (email) {
        queryData = [
          { email },
          { phone: phone.toString() },
          { username }
        ]
      } else {
        if (keys.multiVersions !== 'bangla') {
          return res.send({ type: types.error, message: 'Email is required', data: {} })
        }
        queryData = [
          { phone: phone.toString() },
          { username }
        ]
      }
      const user = await UsersModel.findOne({
        where: {
          [Op.or]: queryData
        }
      })

      if (user) {
        return res.send({ type: types.error, message: messages[req.userLanguage].already_register, data: user })
      } else {
        const role = await RolesModel.findOne({
          where: { name: 'User' },
          raw: true,
          cache: true,
          expire: 500
        })
        if (role) {
          const roleID = role.id

          const hash = bcrypt.hashSync(password, saltRounds)
          const phone_code = Math.floor(100000 + Math.random() * 900000)
          const email_code = Math.floor(100000 + Math.random() * 900000)
          const salt = Math.random().toString().replace('0.', '')
          const token = bcrypt.hashSync(salt, saltRounds)

          const len = 7
          const my_refer_code = crypto.randomBytes(Math.ceil(len / 2))
            .toString('hex') // convert to hexadecimal format
            .slice(0, len) // return required number of characters

          let affiliate = ''
          if (affiliate_field) {
            affiliate = affiliate_field
          }

          let g_id = ''
          // let g_token = ''
          let fb_id = ''
          let fb_token = ''
          let apple_uid = ''
          let email_verify = '0'
          const phone_verify = '1'
          if (login_with) {
            if (login_with === 'google') {
              email_verify = '1'
              g_id = uid
              // g_token = social_token
            }
            if (login_with === 'facebook') {
              email_verify = '1'
              fb_id = uid
              fb_token = social_token
            }
            if (login_with === 'apple') {
              email_verify = '1'
              apple_uid = uid
            }
          }

          const current_date_time = getFiveThirtyPlusDate()
          const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress

          let platform = req.body.platform || req.params.platform || req.query.platform
          if (platform && !['0', '1', '2', '3'].includes(platform)) {
            platform = null
          }

          const checkOTP = await MobileVerificationModel.findOne({
            where: {
              is_verify: 'y',
              mobile_number: phone
            },
            raw: true
          })

          if (!checkOTP) {
            return res.send({ type: types.error, message: messages[req.userLanguage].error_with.replace('##', 'OTP verification') })
          }

          if (keys.multiVersions !== 'bangla') {
            const msgVerify = await verifyPhoneOtp(phone, checkOTP.code)

            if (msgVerify.data.type === 'error') {
              return res.send({ type: types.error, message: messages[req.userLanguage].error_with.replace('##', 'OTP verification') })
            }
          }

          const results = await UsersModel.create({
            name: user_name,
            platform,
            username,
            email,
            email_verify,
            phone,
            phone_verify,
            city_id: city,
            password: hash,
            email_code,
            phone_code,
            role_id: roleID,
            created_at: current_date_time,
            updated_at: current_date_time,
            api_token: token,
            affiliate_field: affiliate,
            google_uid: g_id,
            google_access_token: '',
            fb_uid: fb_id,
            fb_access_token: fb_token,
            apple_uid,
            my_refer_code,
            ipaddress: ip
          })

          affiliate = ''
          let campaignName = ''
          if (affiliate_field) {
            affiliate = affiliate_field
            const array1 = affiliate.split('-')
            campaignName = array1[0]
            const MediumId = array1[array1.length - 2]
            let transactionId = array1[array1.length - 1]
            transactionId = transactionId.replace('|', '-')

            if (campaignName && transactionId) {
              const url123 = 'https://www.countrypoker.com/register/affiliate?_token=' + token + '&api_login=affiliatetest&api_password=affiliatetest&user_id=' + results[0] + '&username=' + username + '&email=' + email + '&phone=' + phone + '&utm_source=' + campaignName + '&utm_medium=' + MediumId + '&utm_campaign=' + transactionId + '&utm_website=11wickets&utm_pid=' + utm_pid + '&utm_offer=' + utm_offer

              axios.get(url123)
                .then()
                .catch(error => console.log(error.response ? error.response.data : 'userController.register'))

              if (campaignName === 'opicle' || campaignName === 'click2commission' || campaignName === 'maadme' || campaignName === 'shisamdigital' || campaignName === 'svgcolumbus' || campaignName === 'adsterra' || campaignName === 'adcounty') {
                UsersModel.findOne({
                  affiliate_verify: '1',
                  updated_at: current_date_time
                }, {
                  api_token: token
                })
                  .then()
                  .catch()
              }
            }
          }

          req.body.api_token = token
          passbookController.registerBonus(req, res)

          if (email) {
            checkRateLimitEmail(email).then(() => {
              const baseUrl = keys.multiVersions === 'bangla' ? 'https://www.11wickets.com.bd' : 'https://www.11wickets.com'
              const contentObj = {
                from: keys.multiVersions === 'bangla' ? keys.mailgunFromBangla : keys.mailgunFrom,
                subject: '11Wickets email verification code',
                html: `<!DOCTYPE html> <html> <head> <title>11wicket</title> </head> <body> <div style="text-align:center"> <a href="${baseUrl}/"><img src="${baseUrl}/img/logo.png" alt="11wicket" style="max-width: 250px;display:inline-block;" /></a> <hr style="border:2px solid #43b4ae;"> </div> <div> <strong style="font-size:18px;">Hello ${req.body.email},</strong><br><br> <p>Thank you for registering with us.<br/><br> <strong>Please activate your account using the below code.</strong></p> </div> <div style="text-align:center"> <a href="#" style="padding: 15px 30px; background: #43b4ae; color: #ffffff; margin-top: 30px; display: inline-block; border-radius: 5px;"> ${email_code} </a> </div> <div style="font-size:15px;"> Thank you,<br> <a href="${baseUrl}/">11wicket Support Team</a> </div> </body> </html>`,
                to: email
              }
              transporter.sendMail(contentObj, function (error) {
                console.log(error)
              })
              return res.send({ type: types.success, message: messages[req.userLanguage].action_success.replace('##', 'Registration'), data: { api_token: token, affiliate: campaignName, user_id: results[0] } })
            }).catch(error => {
              console.log('register', error)
              return res.send({ type: types.success, message: messages[req.userLanguage].action_success.replace('##', 'Registration'), data: { api_token: token, affiliate: campaignName, user_id: results[0] } })
            })
          } else {
            return res.send({ type: types.success, message: messages[req.userLanguage].action_success.replace('##', 'Registration'), data: { api_token: token, affiliate: campaignName, user_id: results[0] } })
          }
        } else {
          return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'Role'), data: role })
        }
      }
    }).catch(error => {
      console.log('register', error)
      return res.status(status.OK).send({ type: types.error, message: error })
    })
  } catch (error) {
    return catchError('userController.registerV2', error, req, res)
  }
}

const activateEmail = async function (req, res) { // done
  try {
    const { type, email, check_code, api_token } = req.query

    const current_date_time = getFiveThirtyPlusDate()
    if (type === 'email') {
      const user = await UsersModel.findOne({
        where: { email, email_code: check_code },
        attributes: ['id', 'api_token', 'first_login']
      })

      if (!user) return res.send({ type: types.error, message: messages[req.userLanguage].otp_not_valid })

      const salt = Math.random().toString().replace('0.', '')
      const token = bcrypt.hashSync(salt, saltRounds)

      user.email_verify = '1'
      user.email_code = ''
      user.api_token = token
      user.last_login = current_date_time

      if (user.first_login == null) {
        user.first_login = current_date_time
      }

      await user.save()
      await redisClient2.del(`at:${api_token}`)

      const baseUrl = keys.multiVersions === 'bangla' ? 'https://www.11wickets.com.bd' : 'https://www.11wickets.com'
      const contentObj = {
        from: keys.multiVersions === 'bangla' ? keys.mailgunFromBangla : keys.mailgunFrom,
        subject: '11Wickets email verified',
        html: `<!DOCTYPE html> <html> <head> <title>11wickets</title> </head> <body> <div style="text-align:center"> <a href="${baseUrl}/"><img src="${baseUrl}/img/logo.png" alt="11wicket" style="max-width: 250px;display:inline-block;" /></a> <hr style="border:2px solid #43b4ae;"> </div> <div> <strong style="font-size:18px;">Hello ${email},</strong><br><br> <p>Welcome to 11wickets.com. <br/><br> Thank you for registering with us.<br/><br> <strong>Your account is activated.</strong></p> </div>  <div style="font-size:15px;"> Thank you,<br> <a href="${baseUrl}/">11wickets Support Team</a> </div> </body> </html>`,
        to: email
      }

      transporter.sendMail(contentObj, function (error) {
        console.log(error)
      })
      return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Data'), data: { api_token: token } })
    } else if (type === 'phone') {
      const user = await UsersModel.findOne({
        where: { phone: email, phone_code: check_code },
        attributes: ['id', 'api_token', 'first_login']
      })

      if (!user) return res.send({ type: types.error, message: messages[req.userLanguage].otp_not_valid })
      const salt = Math.random().toString().replace('0.', '')
      const token = bcrypt.hashSync(salt, saltRounds)

      user.phone_verify = '1'
      user.phone_code = ''
      user.api_token = token
      user.last_login = current_date_time

      if (user.first_login == null) {
        user.last_login = current_date_time
      }

      await user.save()
      await redisClient2.del(`at:${api_token}`)
      return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Data'), data: { api_token: token } })
    }
  } catch (error) {
    return catchError('userController.activateEmail', error, req, res)
  }
}

const socialRegisterNew = async function (req, res) { // done
  try {
    const { login_with, social_token } = req.body

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

    return res.send({ type: types.success, message: messages[req.userLanguage].retrieved_success.replace('##', 'Data'), data: { username: user.username, api_token: user.api_token } })
  } catch (error) {
    return catchError('userController.socialRegisterNew', error, req, res)
  }
}

const login = async function (req, res) { // done
  try {
    const { password, phone } = req.body

    const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',') : []
    checkRateLimitLogin(ip[0]).then(async () => {
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
        failedLogins.collection.insertOne({ ...req.body }).then().catch()
        return res.status(status.Forbidden).send({ type: types.error, message: messages[req.userLanguage].auth_fail })
      }

      if (user.role_id === 10) return res.status(status.Forbidden).send({ type: types.error, message: messages[req.userLanguage].account_suspended })

      if (!user.api_token) {
        const salt = Math.random().toString().replace('0.', '')
        const token = bcrypt.hashSync(salt, saltRounds)
        user.api_token = token
        user.last_login = getFiveThirtyPlusDate()
        user.updated_at = getFiveThirtyPlusDate()
        await user.save()
      }

      const str = phone
      let r = 0
      if (str.match(/[a-z]/i)) {
        r = 1
      }

      if (r === 0 && user.phone_verify === '0') {
        return res.status(status.OK).send({ type: 'phone-warning', message: messages[req.userLanguage].mob_verify_err })
      } else {
        const hash = user.password
        if (bcrypt.compareSync(password, hash) === true) {
          user.last_login = getFiveThirtyPlusDate()
          await user.save()
          req.body.api_token = user.api_token
          req.body.user_platform = user.platform || 0
          passbookController.mobileLoginBonus(req, res)

          return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].login_succ, data: { api_token: user.api_token } })
        } else {
          return res.status(status.OK).send({ type: types.error, message: messages[req.userLanguage].email_pass_match_err })
        }
      }
    }).catch(error => {
      console.log({ error })
      return res.status(status.OK).send({ type: types.error, message: error })
    })
  } catch (error) {
    return catchError('userController.login', error, req, res)
  }
}

const userDashboard = async function (req, res) { // done
  try {
    let user = await UsersModel.findOne({
      where: { id: req.user.id },
      include: [{
        model: PassbooksModel,
        where: { user_id: req.user.id },
        limit: 1,
        attributes: ['total_cash', 'total_bonus', 'winnings', 'deposits'],
        order: [['id', 'DESC']]
      }],
      attributes: ['name', 'phone', 'profile_pic', 'total_win', 'my_refer_code', 'loyalty_points']
    })

    if (!user) {
      return res.send({
        type: types.error,
        message: messages[req.userLanguage].not_found.replace('##', 'User'),
        data: []
      })
    }

    user = user.toJSON()
    return res.send({
      type: types.success,
      message: messages[req.userLanguage].success,
      data: [{
        name: user.name,
        phone: user.phone,
        profile_pic: user.profile_pic ? `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/profile/${user.profile_pic}` : '',
        total_win: user.total_win,
        my_refer_code: user.my_refer_code,
        id: user.id,
        loyalty_points: user.loyalty_points,
        current_cash: user.passbooks[0] && user.passbooks[0].total_cash,
        current_bonus: user.passbooks[0] && user.passbooks[0].total_bonus,
        winnings: user.passbooks[0] && user.passbooks[0].winnings,
        deposits: user.passbooks[0] && user.passbooks[0].deposits
      }]
    })
  } catch (error) {
    return catchError('userController.userDashboard', error, req, res)
  }
}

const viewBankInfo = async function (req, res) { // done
  try {
    const user = await UsersModel.findOne({
      where: { id: req.user.id },
      attributes: ['bank_change_approval', 'bank_name', 'bank_account_name', 'bank_account_no', 'ifsc']
    })
    const l = { instant: 'instant', cheque: 'cheque' }

    return res.send({ type: types.success, message: messages[req.userLanguage].not_found.replace('##', 'User'), data: { user: [user], withdrawal_type: l } })
  } catch (error) {
    return catchError('userController.viewBankInfo', error, req, res)
  }
}

const viewDocument = async function (req, res) { 
  console.log("Test PanCard");
  try {
    let user = await UsersModel.findOne({
      where: { id: req.user.id },
      attributes: ['pancard_verify', 'pancard_no', 'id_proof_verify', 'pancard', 'id_proof_front', 'id_proof_back', 'id_proof_no']
    })

    user = user.toJSON()
    if (user.pancard) {
      user.pancard = `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/test_documents/${user.pancard}`
    }
    if (user.id_proof_front) {
      user.id_proof_front = `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/test_documents/${user.id_proof_front}`
    }
    if (user.id_proof_back) {
      user.id_proof_back = `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/test_documents/${user.id_proof_back}`
    }

    return res.send({ type: types.success, message: messages[req.userLanguage].not_found.replace('##', 'User'), data: [user] })
  } catch (error) {
    return catchError('userController.viewDocument', error, req, res)
  }
}

const viewDocumentV2 = async function (req, res) { // done
  try {
    let user = await UsersModel.findOne({
      where: { id: req.user.id },
      attributes: ['pancard_verify', 'pancard_no', 'id_proof_verify', 'pancard', 'id_proof_front', 'id_proof_back', 'id_proof_no', 'pancard_name', 'dob']
    })

    user = user.toJSON()
    if (user.pancard) {
      user.pancard = `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/test_documents/${user.pancard}`
    }
    if (user.id_proof_front) {
      user.id_proof_front = `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/test_documents/${user.id_proof_front}`
    }
    if (user.id_proof_back) {
      user.id_proof_back = `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/test_documents/${user.id_proof_back}`
    }

    return res.send({ type: types.success, message: messages[req.userLanguage].not_found.replace('##', 'User'), data: [user] })
  } catch (error) {
    return catchError('userController.viewDocument', error, req, res)
  }
}

const emailSendCode = async function (req, res) {
  try {
    const { phone, api_token } = req.body

    const user = await UsersModel.findOne({
      where: { email: phone, admin_block: '0', role_id: 2 },
      attributes: ['id', 'email']
    })

    if (user) {
      const email_code = Math.floor(100000 + Math.random() * 900000)

      user.email_code = email_code
      await user.save()

      checkRateLimitEmail(phone).then(async () => {
        const baseUrl = keys.multiVersions === 'bangla' ? 'https://www.11wickets.com.bd' : 'https://www.11wickets.com'
        const contentObj = {
          from: keys.multiVersions === 'bangla' ? keys.mailgunFromBangla : keys.mailgunFrom,
          subject: '11Wickets email verification code',
          to: phone,
          html: `<!DOCTYPE html> <html> <head> <title>11wicket</title> </head> <body> <div style="text-align:center"> <a href="${baseUrl}/"><img src="${baseUrl}/img/logo.png" alt="11wicket" style="max-width: 250px;display:inline-block;" /></a> <hr style="border:2px solid #43b4ae;"> </div> <div> <strong style="font-size:18px;">Hello ${phone},</strong><br><br> <p>You have requested to reset you password.<br/><br> <strong>Please reset your password using the below otp.</strong></p> </div> <div style="text-align:center"> <a href="#" style="padding: 15px 30px; background: #43b4ae; color: #ffffff; margin-top: 30px; display: inline-block; border-radius: 5px;"> ${email_code} </a> <br/> <br/> <p> If you have not requested to reset your password then kindly ignore this email. </p> </div> <div style="font-size:15px;"> Thank you,<br> <a href="${baseUrl}/">11wicket Support Team</a> </div> </body> </html>`
        }

        transporter.sendMail(contentObj, function (error) {
          console.log(error)
        })

        await redisClient2.del(`at:${api_token}`)
        return res.send({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'Email'), data: user })
      }).catch(error => {
        return res.send({ type: types.error, message: error, data: [] })
      })
    } else {
      return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'User'), data: {} })
    }
  } catch (error) {
    return catchError('userController.emailSendCode', error, req, res)
  }
}

const emailPhoneExists = async function (req, res) {
  try {
    const { email: reqEmail, phone, username } = req.body
    let email = reqEmail
    let queryData
    if (reqEmail) {
      const result = modifyGmailEmail(reqEmail)
      if (!result.success) {
        return res.send({ type: types.error, message: result.message, data: {} })
      }
      email = result.email
      queryData = [
        { email },
        { phone: phone.toString() },
        { username }
      ]
    } else {
      if (keys.multiVersions !== 'bangla') {
        return res.send({ type: types.error, message: 'Email is required', data: {} })
      }
      queryData = [
        { phone: phone.toString() },
        { username }
      ]
    }

    const user = await UsersModel.findOne({
      where: {
        [Op.or]: queryData
      },
      attributes: ['id', 'email', 'phone', 'username']
    })

    if (user) {
      let msg = 'Username exists'

      if (user.email === email && user.phone === phone && user.username === username) msg = 'Email & phone & username exists'
      else if (user.email === email && user.phone === phone) msg = 'Email & phone exists'
      else if (user.email === email && user.username === username) msg = 'Email & username exists'
      else if (user.phone === phone && user.username === username) msg = 'Phone & username exists'
      else if (user.email === email) msg = 'Email exists'
      else if (user.phone === phone) msg = 'Phone exists'
      else if (user.username === username) msg = 'Username exists'

      return res.send({ type: types.error, message: msg, data: {} })
    } else {
      return res.send({ type: types.success, message: messages[req.userLanguage].not_found.replace('##', 'User'), data: user })
    }
  } catch (error) {
    return catchError('userController.emailPhoneExists', error, req, res)
  }
}

const changeCurrentPassword = async function (req, res) { // done
  try {
    const { current_password, password } = req.body
    const user = await UsersModel.findOne({
      where: { id: req.user.id },
      attributes: ['id', 'password']
    })

    if (!user) return res.send({ type: types.error, message: messages[req.userLanguage].auth_fail, data: user })
    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.send({ type: types.error, message: messages[req.userLanguage].password_wrong })
    }
    const hash = bcrypt.hashSync(password, saltRounds)

    user.password = hash
    await user.save()

    return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Password') })
  } catch (error) {
    return catchError('userController.changeCurrentPassword', error, req, res)
  }
}

const myContestAndMatchesCount = async function (req, res) { // done
  try {
    const contests_count = await UserLeaguesModel.count({
      where: { user_id: req.user.id }
    })

    const matches_count = await UserLeaguesModel.count({
      where: { user_id: req.user.id },
      distinct: true,
      col: 'match_id'
    })
    return res.send({
      type: types.success,
      message: messages[req.userLanguage].success,
      data: {
        contests_count,
        matches_count
      }
    })
  } catch (error) {
    return catchError('userController.myContestAndMatchesCount', error, req, res)
  }
}

const submitInstantWithdraw = async (req, res) => { // pending
  try {
    const requestData = req.body
    const balance = requestData.withdraw_amount

    let validationKey = ''
    if (requestData.wallet_address) {
      validationKey = 'vCryptoWithdrawlAmount'
    } else if (requestData.withdraw_type === 'instance-paytm-withdrawal' || requestData.withdraw_type === 'instant-bank-withdrawal' || requestData.withdraw_type === 'instant-amazon-pay-withdrawal' || requestData.withdraw_type === 'instant-bikash-withdrawal' || requestData.withdraw_type === 'instant-nagad-withdrawal' || requestData.withdraw_type === 'instant-rocket-withdrawal') {
      validationKey = 'vInstantWithdrawlAmount'
    } else {
      validationKey = 'vWithdrawlAmount'
    }
    const validationData = await ValidationModel.findOne({
      where: { name: validationKey },
      attributes: ['name', 'min', 'max'],
      raw: true
    })
    const minWithdrawl = (validationData) ? validationData.min : 250
    const maxWithdrawl = (validationData) ? validationData.max : 1000

    if (balance < minWithdrawl) {
      return res.send({ type: types.error, message: `Please enter minimum ${multiVersions.currencySymbol} ${minWithdrawl} for withdraw`, data: [] })
    }

    const user = await UsersModel.findOne({
      where: { id: req.user.id, admin_block: '0', role_id: 2 }
    })

    if (!user) {
      return res.send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'User'), data: [] })
    }
    if (user.phone_verify !== '1') {
      return res.send({ type: 'phone-warning', message: messages[req.userLanguage].mob_verify_err, data: { api_token: user.api_token, phone: user.phone } })
    }
    if (keys.multiVersions !== 'bangla' && user.email_verify !== '1') {
      return res.send({ type: types.error, message: messages[req.userLanguage].email_verify_err, data: [] })
    }
    if (keys.multiVersions !== 'bangla' && user.pancard_verify !== '1') {
      return res.send({ type: types.error, message: messages[req.userLanguage].pancard_not_approved, data: [] })
    }
    if (keys.multiVersions !== 'bangla' && user.id_proof_verify !== '1') {
      return res.send({ type: types.error, message: messages[req.userLanguage].pancard_not_approved, data: [] })
    }

    if (keys.multiVersions === 'bangla' && user.id_proof_verify !== '1') {
      return res.send({ type: types.error, message: messages[req.userLanguage].id_proof_not_approved, data: [] })
    }

    if (!user.phone || !user.email) {
      return res.send({ type: types.error, message: messages[req.userLanguage].fill_profile_err, data: [] })
    }

    if (keys.multiVersions !== 'bangla' && (!user.name || !user.bank_account_no || !user.ifsc || !user.address)) {
      return res.send({ type: types.error, message: messages[req.userLanguage].fill_profile_err, data: [] })
    }

    if (keys.multiVersions === 'bangla') {
      if (requestData.withdraw_type === 'bank-withdrawal' || requestData.withdraw_type === 'instant-bank-withdrawal') {
        if (!user.name || !user.bank_account_no || !user.ifsc || !user.address) {
          return res.send({ type: types.error, message: messages[req.userLanguage].withdrawl_details_required, data: [] })
        }
        return res.send({ type: types.error, message: messages[req.userLanguage].bank_withdraw_unavailable, data: [] })
      }
      const userPaymentMethodData = await UserPaymentMethodModel.findOne({
        where: { user_id: req.user.id }
      })
      const bikashAcc = (userPaymentMethodData) ? userPaymentMethodData.bikash_acc : null
      const nagadAcc = (userPaymentMethodData) ? userPaymentMethodData.nagad_acc : null
      const rocketAcc = (userPaymentMethodData) ? userPaymentMethodData.rocket_acc : null

      if (requestData.withdraw_type === 'bikash-withdrawal' || requestData.withdraw_type === 'instant-bikash-withdrawal') {
        if (balance > 10000) {
          return res.send({ type: types.error, message: `Please enter maximum ${multiVersions.currencySymbol} 10000 for withdraw`, data: [] })
        }
        if (!bikashAcc) {
          return res.send({ type: types.error, message: messages[req.userLanguage].withdrawl_details_required, data: [] })
        }
      } else if (requestData.withdraw_type === 'nagad-withdrawal' || requestData.withdraw_type === 'instant-nagad-withdrawal') {
        if (balance > maxWithdrawl) {
          return res.send({ type: types.error, message: `Please enter maximum ${multiVersions.currencySymbol} ${maxWithdrawl} for withdraw`, data: [] })
        }
        if (!nagadAcc) {
          return res.send({ type: types.error, message: messages[req.userLanguage].withdrawl_details_required, data: [] })
        }
      } else if (requestData.withdraw_type === 'rocket-withdrawal' || requestData.withdraw_type === 'instant-rocket-withdrawal') {
        if (balance > maxWithdrawl) {
          return res.send({ type: types.error, message: `Please enter maximum ${multiVersions.currencySymbol} ${maxWithdrawl} for withdraw`, data: [] })
        }
        if (!rocketAcc) {
          return res.send({ type: types.error, message: messages[req.userLanguage].withdrawl_details_required, data: [] })
        }
      }
    }

    if (user.instant_withdraw !== '0' && (requestData.withdraw_type === 'instance-paytm-withdrawal' || requestData.withdraw_type === 'instant-bank-withdrawal' || requestData.withdraw_type === 'instant-amazon-pay-withdrawal' || requestData.withdraw_type === 'instant-bikash-withdrawal' || requestData.withdraw_type === 'instant-nagad-withdrawal' || requestData.withdraw_type === 'instant-rocket-withdrawal')) {
      return res.send({ type: types.error, message: messages[req.userLanguage].withdraw_block_err, data: [] })
    }

    const userCurrentPassbookData = await PassbooksModel.findOne({
      where: { user_id: req.user.id },
      order: [['id', 'DESC']]
    })

    const d = await sequelize.query(
      'SELECT parent.id, parent.parent_id FROM passbooks as parent WHERE NOT EXISTS(SELECT 1 FROM passbooks child WHERE child.parent_id=parent.id) and parent.user_id=:user_id and particular="Withdraw" and parent_id is null and order_status="Pending";',
      { raw: true, replacements: { user_id: user.id }, type: Sequelize.QueryTypes.SELECT }
    )

    if (d && d.length > 0) {
      return res.send({ type: types.error, message: messages[req.userLanguage].pending_withdraw_req, data: [] })
    }

    // const totalBalance = userCurrentPassbookData.winnings
    const totalBalance = (keys.multiVersions !== 'bangla') ? userCurrentPassbookData.total_cash : userCurrentPassbookData.winnings

    if (!(totalBalance >= balance)) {
      return res.send({ type: types.error, message: messages[req.userLanguage].insufficient_withdraw.replace('##', `${multiVersions.currencySymbol}${totalBalance},`), data: [] })
    }

    let winningsToDeduct = 0
    let depositToDeduct = 0

    if (userCurrentPassbookData.winnings < balance) {
      winningsToDeduct = userCurrentPassbookData.winnings
      depositToDeduct = balance - userCurrentPassbookData.winnings
    } else {
      winningsToDeduct = balance
    }

    let [deposit, playCount] = await sequelize.query(
      'SELECT sum(amount) as total_deposit FROM passbooks WHERE user_id=:user_id AND type="Cr" AND (Particular="Deposit" OR Particular="Opening") AND order_status="Complete" ORDER BY id DESC LIMIT 1; select ((count(CASE WHEN particular = "Play" THEN cash END)) - (count(CASE WHEN particular = "Play-Return" THEN cash END))) as "result" from passbooks where user_id=:user_id and amount > "0" and ((particular = "Play" and type = "Dr") or (particular = "Play-Return" and type = "Cr"))',
      { raw: true, replacements: { user_id: user.id }, type: Sequelize.QueryTypes.SELECT }
    ) // need to calculate the date

    deposit = deposit[0]
    playCount = playCount[0].result
    if (!deposit || deposit.total_deposit < 25) {
      return res.send({ type: types.error, message: messages[req.userLanguage].min_deposit_for_withdraw.replace('##', `${multiVersions.currency}`), data: [] })
    }

    if (playCount < 1) {
      return res.send({ type: types.error, message: messages[req.userLanguage].play_league_for_withdraw, data: [] })
    }

    if ((requestData.withdraw_type === 'instance-paytm-withdrawal')) {
      if (balance > maxWithdrawl) {
        return res.send({ type: types.error, message: messages[req.userLanguage].max_instant_withdraw.replace('##', `${multiVersions.currency}${maxWithdrawl}`), data: [] })
      }

      let parentIds = await sequelize.query(
        'SELECT parent_id FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND order_status="Cancel" AND DATE(created_at) > :date;',
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('7', 'days').format('YYYY-MM-DD') }, type: Sequelize.QueryTypes.SELECT }
      ) // need to calculate the date

      let instantWithdrawComplete = await sequelize.query(
        'SELECT count(id) as completedWithdraw FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND type="Dr" AND order_status="Complete" AND remarks="instance-paytm-withdrawal" AND DATE(created_at) > :date ORDER BY id DESC LIMIT 1;',
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('7', 'days').format('YYYY-MM-DD') }, type: Sequelize.QueryTypes.SELECT }
      )
      let instantWithdrawPending = [{ pendingCounts: 0 }]

      let instantWithdrawPendingQuery = 'SELECT count(id) as pendingCounts FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND order_status="Pending" AND type="Dr" AND remarks="instance-paytm-withdrawal" AND DATE(created_at) > :date'

      parentIds = parentIds.map(s => s.parent_id)
      if (parentIds.length > 0) {
        instantWithdrawPendingQuery += ' AND id NOT IN (:parentIds)'
      }

      instantWithdrawPending = await sequelize.query(instantWithdrawPendingQuery,
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('7', 'days').format('YYYY-MM-DD'), parentIds: parentIds }, type: Sequelize.QueryTypes.SELECT }
      )

      instantWithdrawComplete = instantWithdrawComplete[0].completedWithdraw
      instantWithdrawPending = instantWithdrawPending[0].pendingCounts

      if (instantWithdrawComplete > 0) {
        return res.send({ type: types.error, message: messages[req.userLanguage].instant_withdraw_limit.replace('##', '7'), data: [] })
      }
      if (instantWithdrawPending > 0) {
        return res.send({ type: types.error, message: messages[req.userLanguage].process_for_instant_withdraw, data: [] })
      }

      if (user.total_play < 50000) {
        return res.send({ type: types.error, message: messages[req.userLanguage].not_eligible_for_iw, data: [] })
      }

      queuePush('instantWithdraw', {
        user_id: user.id,
        withdraw_amount: requestData.withdraw_amount,
        withdraw_type: requestData.withdraw_type,
        ip: req.header('x-forwarded-for') || req.connection.remoteAddress
      })

      return res.send({ type: types.success, message: messages[req.userLanguage].instant_withdraw_req_received })
    } else if (requestData.withdraw_type === 'instant-bank-withdrawal') {
      if (balance > maxWithdrawl) {
        return res.send({ type: types.error, message: messages[req.userLanguage].max_instant_withdraw.replace('##', `${multiVersions.currency}${maxWithdrawl}`), data: [] })
      }

      let parentIds = await sequelize.query(
        'SELECT parent_id FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND order_status="Cancel" AND DATE(created_at) > :date;',
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('1', 'days').format('YYYY-MM-DD') }, type: Sequelize.QueryTypes.SELECT }
      ) // need to calculate the date

      let instantWithdrawComplete = await sequelize.query(
        'SELECT count(id) as completedWithdraw FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND type="Dr" AND order_status="Complete" AND remarks="instant-bank-withdrawal" AND DATE(created_at) > :date ORDER BY id DESC LIMIT 1;',
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('1', 'days').format('YYYY-MM-DD') }, type: Sequelize.QueryTypes.SELECT }
      )
      let instantWithdrawPending = [{ pendingCounts: 0 }]

      let instantWithdrawPendingQuery = 'SELECT count(id) as pendingCounts FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND order_status="Pending" AND type="Dr" AND remarks="instant-bank-withdrawal" AND DATE(created_at) > :date'

      parentIds = parentIds.map(s => s.parent_id)
      if (parentIds.length > 0) {
        instantWithdrawPendingQuery += ' AND id NOT IN (:parentIds)'
      }

      instantWithdrawPending = await sequelize.query(instantWithdrawPendingQuery,
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('1', 'days').format('YYYY-MM-DD'), parentIds: parentIds }, type: Sequelize.QueryTypes.SELECT }
      )

      instantWithdrawComplete = instantWithdrawComplete[0].completedWithdraw
      instantWithdrawPending = instantWithdrawPending[0].pendingCounts

      if (instantWithdrawComplete > 0) {
        return res.send({ type: types.error, message: messages[req.userLanguage].instant_withdraw_limit.replace('##', '1'), data: [] })
      }
      if (instantWithdrawPending > 0) {
        return res.send({ type: types.error, message: messages[req.userLanguage].process_for_instant_withdraw, data: [] })
      }

      if (user.total_play < 50000) {
        return res.send({ type: types.error, message: messages[req.userLanguage].not_eligible_for_iw, data: [] })
      }

      queuePush('instantWithdraw', {
        user_id: user.id,
        withdraw_amount: requestData.withdraw_amount,
        withdraw_type: requestData.withdraw_type,
        ip: req.header('x-forwarded-for') || req.connection.remoteAddress
      })

      return res.send({ type: types.success, message: messages[req.userLanguage].instant_withdraw_req_received })
    } else if (requestData.withdraw_type === 'instant-amazon-pay-withdrawal') {
      if (balance > maxWithdrawl) {
        return res.send({ type: types.error, message: messages[req.userLanguage].max_instant_withdraw.replace('##', `${multiVersions.currency}${maxWithdrawl}`), data: [] })
      }

      // const parentIds = await PassbooksModel.findOne({
      //   where: {
      //     user_id: user.id,
      //     particular: 'Withdraw',
      //     order_status: 'Cancel',
      //     created_at: moment().subtract('1', 'days')
      //   },
      //   attributes: ['parent_id']
      // })

      let parentIds = await sequelize.query(
        'SELECT parent_id FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND order_status="Cancel" AND DATE(created_at) > :date;',
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('7', 'days').format('YYYY-MM-DD') }, type: Sequelize.QueryTypes.SELECT }
      ) // need to calculate the date

      let instantWithdrawComplete = await sequelize.query(
        'SELECT count(id) as completedWithdraw FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND type="Dr" AND order_status="Complete" AND remarks="instant-amazon-pay-withdrawal" AND DATE(created_at) > :date ORDER BY id DESC LIMIT 1;',
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('7', 'days').format('YYYY-MM-DD') }, type: Sequelize.QueryTypes.SELECT }
      )
      let instantWithdrawPending = [{ pendingCounts: 0 }]

      let instantWithdrawPendingQuery = 'SELECT count(id) as pendingCounts FROM passbooks WHERE user_id=:user_id AND Particular="Withdraw" AND order_status="Pending" AND type="Dr" AND remarks="instant-amazon-pay-withdrawal" AND DATE(created_at) > :date'

      parentIds = parentIds.map(s => s.parent_id)
      if (parentIds.length > 0) {
        instantWithdrawPendingQuery += ' AND id NOT IN (:parentIds)'
      }

      instantWithdrawPending = await sequelize.query(instantWithdrawPendingQuery,
        { raw: true, replacements: { user_id: user.id, date: moment().subtract('7', 'days').format('YYYY-MM-DD'), parentIds: parentIds }, type: Sequelize.QueryTypes.SELECT }
      )

      instantWithdrawComplete = instantWithdrawComplete[0].completedWithdraw
      instantWithdrawPending = instantWithdrawPending[0].pendingCounts

      if (instantWithdrawComplete > 0) {
        return res.send({ type: types.error, message: messages[req.userLanguage].instant_withdraw_limit.replace('##', '7'), data: [] })
      }
      if (instantWithdrawPending > 0) {
        return res.send({ type: types.error, message: messages[req.userLanguage].process_for_instant_withdraw, data: [] })
      }

      if (user.total_play < 50000) {
        return res.send({ type: types.error, message: messages[req.userLanguage].not_eligible_for_iw, data: [] })
      }

      queuePush('instantWithdraw', {
        user_id: user.id,
        withdraw_amount: requestData.withdraw_amount,
        withdraw_type: requestData.withdraw_type,
        ip: req.header('x-forwarded-for') || req.connection.remoteAddress
      })

      return res.send({ type: types.success, message: messages[req.userLanguage].instant_withdraw_req_received })
    } else {
      let beneficiary_id
      if (user.beneficiary_id) {
        beneficiary_id = user.beneficiary_id
      } else {
        beneficiary_id = user.id
      }

      const current_time = getFiveThirtyPlusDate()
      const transaction = await sequelize.transaction()

      try {
        // const passbookData = await PassbooksModel.findOne({
        //   where: { user_id: user.id },
        //   order: [['id', 'desc']],
        //   transaction,
        //   lock: true
        // })

        // const results = await PassbooksModel.create({
        //   user_id: user.id,
        //   amount: balance,
        //   type: 'Dr',
        //   winnings: passbookData.winnings - balance,
        //   deposits: passbookData.deposits,
        //   cash: balance,
        //   total_cash: passbookData.total_cash - balance,
        //    bonus: 0,
        //   total_bonus: passbookData.total_bonus,
        //   particular: 'Withdraw',
        //   activity_date: current_time,
        //   remarks: requestData.withdraw_type,
        //   order_status: 'Pending',
        //   updated_at: current_time,
        //   created_atcurrent_time
        // }, {
        //   transaction,
        //   lock: true
        // })

        const results = await sequelize.query(
          'INSERT INTO passbooks (user_id, amount, type, winnings, deposits, cash, total_cash, bonus, total_bonus, particular, activity_date, remarks, order_status, updated_at, created_at, paymentinfo) SELECT user_id, :amount, :type, (winnings - :winningsToDeduct), (deposits - :depositToDeduct), :amount, (total_cash - :amount), 0, total_bonus, :particular, :current_time, :withdraw_type, :order_status, :current_time, :current_time, :paymentinfo FROM passbooks WHERE user_id=:user_id ORDER BY id DESC LIMIT 1 FOR UPDATE;'
          , {
            raw: true,
            replacements: {
              user_id: user.id,
              amount: balance,
              winningsToDeduct,
              depositToDeduct,
              type: 'Dr',
              particular: 'Withdraw',
              current_time,
              withdraw_type: requestData.withdraw_type,
              order_status: 'Pending',
              paymentinfo: requestData.wallet_address || ''
            },
            transaction,
            type: Sequelize.QueryTypes.INSERT
          }
        )

        if (results) {
          await UsersModel.update({
            current_cash: literal(`current_cash - ${balance}`),
            beneficiary_id,
            winnings: literal(`winnings - ${winningsToDeduct}`),
            deposits: literal(`deposits - ${depositToDeduct}`)
          }, {
            where: { id: user.id },
            transaction
          })
        }
        await transaction.commit()
        return res.send({
          type: types.success,
          message: messages[req.userLanguage].withdraw_process,
          data: { current_cash: userCurrentPassbookData.total_cash - balance }
        })
      } catch (error) {
        await transaction.rollback()
        return catchError('userController.submitInstantWithdraw', error, req, res)
      }
    }
  } catch (error) {
    // Sentry.captureMessage(error)
    return catchError('userController.submitInstantWithdraw', error, req, res)
  }
}

const getSignedUrl = async (req, res) => {
  console.log(req.body);
  try {
    var req_data = JSON.stringify(req.body)
    if (!['pro-pic', 'pan', 'id-front', 'id-back'].includes(req.params.type)) {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
    }
    console.log(req.user.id);
    const user = await UsersModel.findOne({
      where: { id: req.user.id },
      //where: { id: 3705775 },
      attributes: ['profile_pic', 'pancard', 'id_proof_front', 'id_proof_back', 'pancard_verify', 'id_proof_verify']
    })
    let { sFileName, sPancardNo, sContentType } = req.body
    console.log("..........Test AdharCard by Indra...........line no 1751......");
    console.log(req.body);
    console.log("..........Test AdharCard by Indra End...........line no 1751......");
    const reqType = req.params.type
    sFileName = sFileName.replace('/', '-')
    sFileName = sFileName.replace(/\s/gi, '-')
    let fileKey = ''
    let s3Path = '/uploads'
    if (reqType === 'pro-pic') {
      s3Path += '/profile'
      fileKey = `${req.user.id}_pro_${Date.now()}_${sFileName}`
    } else if (reqType === 'pan') {
      console.log("Test PanCard");
      console.log(user.pancard_verify);
      console.log("..Test PanCard..");
      if (user.pancard_verify === '1') return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].already_verified.replace('##', 'PAN Card') })
      if (user.pancard) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].kyc_under_review })
      if (!sPancardNo) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'PAN Card No') })
      const panExist = await UsersModel.findOne({
        where: { pancard_no: sPancardNo },
        attributes: ['id']
      })
      if (panExist) {
        return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].pan_exists })
      }

      s3Path += '/test_documents'
      fileKey = `pan/${req.user.id}_pan_${Date.now()}_${sFileName}`
    } else if (reqType === 'id-front' || reqType === 'id-back') {
      console.log("..........Test AdharCard by Indra...........line no 1780......");
      if (user.id_proof_verify === '1') return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].already_verified.replace('##', 'ID Proof') })
      if ((reqType === 'id-front' && user.id_proof_front) && (reqType === 'id-back' && user.id_proof_back)) 
         return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].kyc_under_review })
      s3Path += '/test_documents'
      fileKey = `user-id-doc/${req.user.id}/${req.user.id}_${reqType}_${Date.now()}_${sFileName}`
    } else {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
    }
    const params = {
      Bucket: keys.awsS3Bucket + s3Path,
      Key: fileKey,
      Expires: 300,
      ContentType: sContentType
    }
    s3.getSignedUrl('putObject', params, function (error, url) {
      if (error) {
        catchError('userController.getSignedUrl', error, req, res)
      } else {
        return res.status(status.OK).jsonp({
          type: types.success,
          message: messages[req.userLanguage].presigned_succ,
          data: { sUrl: url, sPath: fileKey }
        })
        
      }
    })
  } catch (error) {
    console.log(`in getSignedUrl function.... line 1663...`);
    catchError('userController.getSignedUrl', error, req, res)
  }
}


// --------------------UpdateImagePath Start -----------------------------------------
const updateImagePath = async (req, res) => {
  try {
    console.log(`in line 1801........${req.body.adhar_number}`)
    const errors = validationResult(req)
    if (!errors.isEmpty()) { return res.send({ type: types.error, message: errors.array() }) }

    if (!['pro-pic', 'pan', 'id-front', 'id-back'].includes(req.params.type)) {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
    }

    const { sPath, sPancardNo, sIdProofNo } = req.body
    const reqType = req.params.type

    const user = await UsersModel.findOne({
      where: { id: req.user.id, role_id: 2 }
    })

    if ((reqType === 'id-front' || reqType === 'id-back') && user.id_proof_verify === '1') 
        return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].already_verified.replace('##', 'ID Proof') })
    if ((reqType === 'id-front' && user.id_proof_front) && (reqType === 'id-back' && user.id_proof_back)) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].kyc_under_review })

    let fileKey = ''
    const current_date_time = getFiveThirtyPlusDate()

    if (reqType === 'pro-pic') {
      if (user.profile_pic) fileKey += `uploads/profile/${user.profile_pic}`

      user.profile_pic = sPath

      console.log("...Test Pan Card line no 1839...");

      await user.save()

      console.log("...Test Pan Card line no 1843...");

    } else if (reqType === 'pan') {
      if (user.pancard_verify === '1') return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].already_verified.replace('##', 'PAN Card') })
      // if (user.pancard) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].kyc_under_review })

      if (!sPancardNo) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'PAN Card No') })

      const panExist = await UsersModel.findOne({
        where: { pancard_no: sPancardNo },
        attributes: ['id']
      })

      if (panExist) res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].pan_exists })

      const current_date_time = getFiveThirtyPlusDate()

      user.pancard = sPath
      user.pancard_no = sPancardNo
      user.pancard_verify = '0'
      user.kyc_uploaded_at = current_date_time
    } else if (reqType === 'id-front') {
          console.log("..TEST ADHARCARD LINE NUMBER 1870..");
      // =---------------------------------------- uncomment karna hai before push on live---------------------------
      // if (keys.multiVersions === 'bangla') {
      //   console.log(`in line 1848 bangla part....`);
      //   if (!sIdProofNo) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'Id Card No') })
      //   const idProofExist = await UsersModel.findOne({
      //     where: { id_proof_no: sIdProofNo },
      //     attributes: ['id']
      //   })
      //   if (idProofExist) res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].id_proof_exists })

      //   user.id_proof_no = sIdProofNo
      // }
      // =---------------------------------------- uncomment karna hai before push on live---------------------------
      // --------------------------------AdharCard Verification From Cashfree Start-------------------------------------------
      
      user.id_proof_front = sPath
      user.id_proof_verify = '0'
      user.kyc_uploaded_at = current_date_time
      
      
      var adhar_number = req.body.adhar_number;
      var adhar_otp = req.body.adhar_otp;
      //var ref_id = req.body.ref_id;
      console.log(`in line 1860 if part....${adhar_number}`);
      console.log(`in line 1864 if part adhar_otp....${adhar_otp}`);
      //console.log(`in line 1864 if part ref_id....${ref_id}`);
      if(adhar_number){
          console.log(`in if part ...1866....`);
          const Payouts = cfSdk.Payouts;
          const payoutsInstance = Payouts.Init({
            'env': 'PROD',
            'ClientID': 'CF2401CFNHK2OD0OAH85U13SK0',
            'ClientSecret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
            'PublicKey': 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3IPD9yWk5IRMEwKL7aZ9OQHAN3vcuuH4g5kQSi6fLtGVYgks6d6d75uRtffzQVrCtXuoqY6LU0Q7vFfo/oNNqBucuNcWwE7/yxBZwjFldFhpmlvFMUwfS5XlcS4utU+kZKBr2/+y1DQHKboHcleZVgXhatiJ47JW2vms32ZrVl/V4/NlOJofiesVa7j4vT8SG1dEUXLaRwYid1XE1/NdqJoHYI4oB7YSv7K9JN5rJo1eE4sR+baFE0KpenTOyDESZGPlMQ1T+nIOkl0gCaKD68BiWN/RZineVI7HZKMER2iqqS9KyDN9djOAiAtPnnfj5ySXYOQCtRQD0NE7PphmkwIDAQAB',
          });
          var payoutsInstance_data = JSON.stringify(payoutsInstance);
          // --------------------------------------------------Signature for Atuthorization----------------------------------------------------
          const adhar_response = await axios({
            method: 'post',
            url: 'https://api.cashfree.com/verification/offline-aadhaar/otp',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'x-api-version': '2022-10-26',
              'x-cf-signature': 'W1Mu2dRomOKuoES0ITecD0pyFtcrWyEbCnoPaPHX3tFgl4TBHkh6GLXZhk+RF+gFZAfSzH2IhflFsTl6+XbO3OKE7MPa5yb6jz5fcJSJuXWjUKRJ9PmcC3qt2BM4e1r00ROxwmvT52WjvA1g54kig/AXaTRHmbRczJLwe6MurVEIhQJvzaehRGcuOa61fOlx2L3h5f5Q4WPmyLOhHM6C3BtmZNor2TsV3ISHQu3gMXhAmci6/Q3kHeGQFC0yj+OSbftioExSn98Ki5CA/lhJYCVho8riWcigrJcZg9PubpQ+QVAD4JjpC9cRZsCibxoF9EEu/Y8X0s+VghN+RyTSSQ==',
              'x-client-id': 'CF2401CFNHK2OD0OAH85U13SK0',
              'x-client-secret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
              'x-request-id':'req123id'
            },
            data: {"aadhaar_number":adhar_number}
          })
           console.log(`in line 1889... ${JSON.stringify(adhar_response.data)}`)
           console.log(`in line 1891 after response... `)
          
          if (adhar_response.data.status == 'SUCCESS' && adhar_response.data.ref_id != '') {
            console.log(`....in line 1918 after response... `)
            return res.status(status.OK).jsonp({ type: types.success, ref_id:adhar_response.data.ref_id, status:adhar_response.data.status })
            //exit();
          } else {
            console.log(`in line 1896... else part...`);
            // return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
            // return res.status(status.OK).jsonp({ type: types.success, ref_id:'123654', status:'SUCCESS' })
            return res.status(status.OK).jsonp({ type: types.success, ref_id:'123654', status:'SUCCESS' })
          }
      }else{
        console.log(`in line 1899 adhar_otp section`)
        const Payouts = cfSdk.Payouts;
        const payoutsInstance = Payouts.Init({
          'env': 'PROD',
          'ClientID': 'CF2401CFNHK2OD0OAH85U13SK0',
          'ClientSecret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
          'PublicKey': 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3IPD9yWk5IRMEwKL7aZ9OQHAN3vcuuH4g5kQSi6fLtGVYgks6d6d75uRtffzQVrCtXuoqY6LU0Q7vFfo/oNNqBucuNcWwE7/yxBZwjFldFhpmlvFMUwfS5XlcS4utU+kZKBr2/+y1DQHKboHcleZVgXhatiJ47JW2vms32ZrVl/V4/NlOJofiesVa7j4vT8SG1dEUXLaRwYid1XE1/NdqJoHYI4oB7YSv7K9JN5rJo1eE4sR+baFE0KpenTOyDESZGPlMQ1T+nIOkl0gCaKD68BiWN/RZineVI7HZKMER2iqqS9KyDN9djOAiAtPnnfj5ySXYOQCtRQD0NE7PphmkwIDAQAB',
        });
        var payoutsInstance_data = JSON.stringify(payoutsInstance);
        // --------------------------------------------------Signature for Atuthorization----------------------------------------------------
        const adhar_otp_res = await axios({
          method: 'post',
          url: 'https://api.cashfree.com/verification/offline-aadhaar/verify',
          headers: {
            'x-client-id': 'CF2401CFNHK2OD0OAH85U13SK0',
            'x-client-secret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
            'Content-Type': 'application/json',
          },
          data: {"otp":adhar_otp,ref_id:ref_id}
        })
        console.log(`in adhar_status valid section line no. 1926... ${JSON.stringify(adhar_otp_res.data)}`);
        if (adhar_otp_res.data.status == 'VALID' && adhar_otp_res.data.ref_id != '') {
          // return res.status(status.OK).jsonp({ type: types.success, ref_id:adhar_otp_res.data.ref_id, status:adhar_otp_res.data.status })
          user.id_proof_front = sPath
          user.id_proof_verify = '0'
          user.kyc_uploaded_at = current_date_time
        if (reqType === 'id-back') {
          user.id_proof_back = sPath
          user.kyc_uploaded_at = current_date_time
        } else {
          return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
        }
        } else {
          return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
        }

      }
      // --------------------------------AdharCard Verification From Cashfree End---------------------------------------------

     
    } else if (reqType === 'id-back') {
      user.id_proof_back = sPath
      user.kyc_uploaded_at = current_date_time
    } else {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
    }

    
    // ----------------------------------------PanCard Verification From CashFree Start-----------------------------------------
    const Payouts = cfSdk.Payouts;
    const payoutsInstance = Payouts.Init({
      'env': 'PROD',
      'ClientID': 'CF2401CFNHK2OD0OAH85U13SK0',
      'ClientSecret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
      'PublicKey': 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3IPD9yWk5IRMEwKL7aZ9OQHAN3vcuuH4g5kQSi6fLtGVYgks6d6d75uRtffzQVrCtXuoqY6LU0Q7vFfo/oNNqBucuNcWwE7/yxBZwjFldFhpmlvFMUwfS5XlcS4utU+kZKBr2/+y1DQHKboHcleZVgXhatiJ47JW2vms32ZrVl/V4/NlOJofiesVa7j4vT8SG1dEUXLaRwYid1XE1/NdqJoHYI4oB7YSv7K9JN5rJo1eE4sR+baFE0KpenTOyDESZGPlMQ1T+nIOkl0gCaKD68BiWN/RZineVI7HZKMER2iqqS9KyDN9djOAiAtPnnfj5ySXYOQCtRQD0NE7PphmkwIDAQAB',
    });
    var payoutsInstance_data = JSON.stringify(payoutsInstance);
    // --------------------------------------------------Signature for Atuthorization----------------------------------------------------
    const pan_response = await axios({
      method: 'post',
      url: 'https://api.cashfree.com/verification/pan',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-version': '2022-10-26',
        'x-cf-signature': 'W1Mu2dRomOKuoES0ITecD0pyFtcrWyEbCnoPaPHX3tFgl4TBHkh6GLXZhk+RF+gFZAfSzH2IhflFsTl6+XbO3OKE7MPa5yb6jz5fcJSJuXWjUKRJ9PmcC3qt2BM4e1r00ROxwmvT52WjvA1g54kig/AXaTRHmbRczJLwe6MurVEIhQJvzaehRGcuOa61fOlx2L3h5f5Q4WPmyLOhHM6C3BtmZNor2TsV3ISHQu3gMXhAmci6/Q3kHeGQFC0yj+OSbftioExSn98Ki5CA/lhJYCVho8riWcigrJcZg9PubpQ+QVAD4JjpC9cRZsCibxoF9EEu/Y8X0s+VghN+RyTSSQ==',
        'x-client-id': 'CF2401CFNHK2OD0OAH85U13SK0',
        'x-client-secret': '58104ee22a7de5cba3f2d1d636fecf26ab6b2833',
        'x-request-id':'req123id'
      },
      data: {"pan":sPancardNo}
    })
    //console.log(data);
    console.log(pan_response.data.pan_status);
    if (pan_response.data.pan_status === 'VALID') {
      user.pancard_verify = '1'
      console.log(`in line 1971...pan valid function11`)
       await user.save()
    } else {
      console.log(`in line 1998...pan NOT valid function`)
      //console.log(`in line 1974...pan valid error`)
      //return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error, custom_data: 'line 1796' })
      //return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].pan_valid })
      return res.send({ type: types.error, message: messages[req.userLanguage].pan_valid })
      //return res.send({ type: types.error, message: messages[req.userLanguage].not_eligible_for_iw, data: [] })
    }
    // ----------------------------------------PanCard Verification From CashFree End-----------------------------------------
    // await user.save()
    if (fileKey && user.profile_pic !== sPath) {
      const s3Params = {
        Bucket: keys.awsS3Bucket,
        Key: fileKey
      }
      await s3.headObject(s3Params).promise()
      s3.deleteObject(s3Params, function (err, data) {
        if (err) {
          console.log(err, err.stack)
        }
        return res.status(status.OK).jsonp({
          type: types.success,
          message: messages[req.userLanguage].updated_succ.replace('##', reqType === 'pro-pic' ? 'Profile picture' : 'Document'),
          data: {
            sPath: reqType === 'pro-pic' ? `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/profile/${sPath}` : `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/${sPath}`
          }
        })
      })
    } else {
      return res.status(status.OK).jsonp({
        type: types.success,
        message: messages[req.userLanguage].updated_succ.replace('##', reqType === 'pro-pic' ? 'Profile picture' : 'Document'),
        data: {
          sPath: reqType === 'pro-pic' ? `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/profile/${sPath}` : `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/${sPath}`
        }
      })
    }
  } catch (error) {
    catchError('userController.updateImagePath', error, req, res)
  }
}
// --------------------UpdateImagePath End -------------------------------------------

const updateImagePathV2 = async (req, res) => {
  try {
    console.log(`in line 1930........`)
    const errors = validationResult(req)
    if (!errors.isEmpty()) { return res.send({ type: types.error, message: errors.array() }) }

    if (!['pro-pic', 'pan', 'id-front', 'id-back'].includes(req.params.type)) {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
    }

    const { sPath, sPancardNo, sIdProofNo, dDob, sPancardName } = req.body
    const reqType = req.params.type

    const user = await UsersModel.findOne({
      where: { id: req.user.id, role_id: 2 }
    })

    if ((reqType === 'id-front' || reqType === 'id-back') && user.id_proof_verify === '1') return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].already_verified.replace('##', 'ID Proof') })
    if ((reqType === 'id-front' && user.id_proof_front) && (reqType === 'id-back' && user.id_proof_back)) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].kyc_under_review })

    let fileKey = ''
    const current_date_time = getFiveThirtyPlusDate()

    if (reqType === 'pro-pic') {
      if (user.profile_pic) fileKey += `uploads/profile/${user.profile_pic}`

      user.profile_pic = sPath
      await user.save()
    } else if (reqType === 'pan') {
      if (user.pancard_verify === '1') return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].already_verified.replace('##', 'PAN Card') })
      // if (user.pancard) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].kyc_under_review })

      if (!sPancardNo) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'PAN Card No') })
      if (!dDob) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'Birth Date') })
      if (!sPancardName) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'PAN Card Name') })

      const panExist = await UsersModel.findOne({
        where: { pancard_no: sPancardNo },
        attributes: ['id']
      })

      if (panExist) res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].pan_exists })

      const current_date_time = getFiveThirtyPlusDate()

      user.pancard = sPath
      user.pancard_no = sPancardNo
      user.pancard_verify = '0'
      user.kyc_uploaded_at = current_date_time
      user.dob = dDob
      user.pancard_name = sPancardName
    } else if (reqType === 'id-front') {
      if (keys.multiVersions === 'bangla') {
        if (!sIdProofNo) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'Id Card No') })
        const idProofExist = await UsersModel.findOne({
          where: { id_proof_no: sIdProofNo },
          attributes: ['id']
        })
        if (idProofExist) res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].id_proof_exists })

        user.id_proof_no = sIdProofNo
      }

      user.id_proof_front = sPath
      user.id_proof_verify = '0'
      user.kyc_uploaded_at = current_date_time
    } else if (reqType === 'id-back') {
      user.id_proof_back = sPath
      user.kyc_uploaded_at = current_date_time
    } else {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
    }
    // console.log(user)
    // await user.save()
    if (fileKey && user.profile_pic !== sPath) {
      const s3Params = {
        Bucket: keys.awsS3Bucket,
        Key: fileKey
      }
      await s3.headObject(s3Params).promise()
      s3.deleteObject(s3Params, function (err, data) {
        if (err) {
          console.log(err, err.stack)
        }
        return res.status(status.OK).jsonp({
          type: types.success,
          message: messages[req.userLanguage].updated_succ.replace('##', reqType === 'pro-pic' ? 'Profile picture' : 'Document'),
          data: {
            sPath: reqType === 'pro-pic' ? `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/profile/${sPath}` : `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/${sPath}`
          }
        })
      })
    } else {
      return res.status(status.OK).jsonp({
        type: types.success,
        message: messages[req.userLanguage].updated_succ.replace('##', reqType === 'pro-pic' ? 'Profile picture' : 'Document'),
        data: {
          sPath: reqType === 'pro-pic' ? `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/uploads/profile/${sPath}` : `https://s3.ap-south-1.amazonaws.com/11wicketsbucket/${sPath}`
        }
      })
    }
  } catch (error) {
    catchError('userController.updateImagePath', error, req, res)
  }
}

const updateKycDetails = async (req, res) => {
  try {
    const { PanCard, IdProof, sReasonPan, sReasonId } = req.body

    const reqVal = ['0', '1', '2']
    const current_date_time = getFiveThirtyPlusDate()

    const user = await UsersModel.findOne({
      where: { id: req.params.user_id, role_id: 2 }
    })

    if (!reqVal.includes(PanCard)) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].wrong_with.replace('##', 'Pan card value') })
    if (!reqVal.includes(IdProof)) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].wrong_with.replace('##', 'ID proof value') })
    if (PanCard === '2' && PanCard !== user.pancard_verify && !sReasonPan) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'Reason for rejection') })
    if (IdProof === '2' && IdProof !== user.id_proof_verify && !sReasonId) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].required.replace('##', 'Reason for rejection') })

    if (!user) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].wrong_with.replace('##', 'User ID') })

    const s3Objects = []
    if (PanCard === '2' && user.pancard) {
      s3Objects.push({ Key: `uploads/test_documents/${user.pancard}` })
    } else if (IdProof === '2') {
      if (user.id_proof_front) s3Objects.push({ Key: `uploads/test_documents/${user.id_proof_front}` })
      if (user.id_proof_back) s3Objects.push({ Key: `uploads/test_documents/${user.id_proof_back}` })
    }

    if (s3Objects.length) {
      const s3Params = {
        Bucket: keys.awsS3Bucket,
        Delete: { Objects: s3Objects, Quiet: false }
      }

      s3.deleteObjects(s3Params, function (err, data) {
        if (err) console.log('S3 Error::', err, err.stack)
      })
    }

    let panQuery = `pancard_verify='${PanCard}'`
    let IdProofQuery = `id_proof_verify='${IdProof}'`
    if (PanCard === '2') panQuery += ', pancard=NULL, pancard_no=NULL'
    if (IdProof === '2') IdProofQuery += ', id_proof_front=NULL, id_proof_back=NULL, id_proof_no=NULL'

    await sequelize.query(`UPDATE users SET ${panQuery}, ${IdProofQuery}, kyc_uploaded_at='${current_date_time}' WHERE id=:user_id`, { raw: true, replacements: { user_id: req.params.user_id }, type: Sequelize.QueryTypes.UPDATE })

    const notifyQuery = []
    if (PanCard !== user.pancard_verify) {
      const title = 'Pancard ' + (PanCard === '1' ? 'Approved' : 'Rejected')
      const message = PanCard === '1' ? 'Your Pancard Is Approved In Our System.' : sReasonPan

      notifyQuery.push({ user_id: user.id, type: '5eb16539f66f71a2a2c69743', title, message, created_at: current_date_time })
    }

    if (IdProof !== user.id_proof_verify) {
      const title = 'ID Proof ' + (IdProof === '1' ? 'Approved' : 'Rejected')
      const message = IdProof === '1' ? 'Your ID Proof Is Approved In Our System.' : sReasonId
      notifyQuery.push({ user_id: user.id, type: '5eb16539f66f71a2a2c69743', title, message, created_at: current_date_time })
    }

    if (notifyQuery.length && (PanCard !== '0' || IdProof !== '0')) {
      await Notifications.insertMany(notifyQuery)
    }
    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'KYC Information') })
  } catch (error) {
    console.log(error)
    catchError('userController.updateKycDetails', error, req, res)
  }
}

const changePhone = async (req, res) => {
  try {
    const api_token = req.query.api_token || req.body.api_token || req.headers.authorization

    const { phone } = req.body
    const user = await UsersModel.findOne({
      where: { id: req.user.id, role_id: 2 }
    })

    if (user.phone === req.body.phone && user.phone_verify === '1') {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].mob_verified })
    } else if (user.phone !== req.body.phone) {
      const phoneExists = await UsersModel.findOne({
        where: { phone: phone.toString() }
      })
      if (phoneExists) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].mob_exists })
    }

    const phone_code = Math.floor(100000 + Math.random() * 900000)

    user.phone_code = phone_code
    await user.save()

    if (keys.multiVersions !== 'bangla') {
      sendOtp(phone, phone_code)
        .then(async () => {
          await redisClient2.del(`at:${api_token}`)
          return res.send({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'OTP'), data: { phone: req.body.phone } })
        }).catch(error => {
          return res.send({ type: types.error, message: error.response.statusText + ' - ' + error.response.config.url, data: error.response.data })
        })
    } else {
      const result = await sendOtpBangla(phone, phone_code)
      if (!result) {
        return res.send({ type: types.error, message: messages[req.userLanguage].error })
      }
      await redisClient2.del(`at:${api_token}`)
      return res.send({ type: types.success, message: messages[req.userLanguage].sent_succ.replace('##', 'OTP'), data: { phone: req.body.phone } })
    }
  } catch (error) {
    catchError('userController.changePhone', error, req, res)
  }
}

const changeEmail = async (req, res) => {
  try {
    const api_token = req.query.api_token || req.body.api_token || req.headers.authorization

    const { email } = req.body
    const user = await UsersModel.findOne({ where: { id: req.user.id } })

    if (user.email === email && user.email_verify === '1') {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].email_verified })
    } else if (user.email !== email) {
      const emailExists = await UsersModel.findOne({
        where: { email }
      })
      if (emailExists) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].email_exists })
    }
    const email_code = Math.floor(100000 + Math.random() * 900000)

    user.email_code = email_code
    await user.save()

    await redisClient2.del(`at:${api_token}`)

    sendmail('account_activation.ejs',
      {
        USER_EMAIL: email,
        OTP_CODE: email_code
      },
      {
        from: keys.mailgunFrom,
        to: email, // list of receivers
        subject: '11Wickets Email Verification' // Subject line
      })
      .then((data) => {
        return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].otp_mail_sent_succ, data: { email } })
      }).catch(error => {
        catchError('userController.changeEmail', error, req, res)
      })
  } catch (error) {
    catchError('userController.changeEmail', error, req, res)
  }
}

const getRegisterPhoneVerifyV2 = async (req, res) => {
  try {
    const { phone } = req.query
    if (keys.multiVersions !== 'bangla') {
      const phone_otp = Math.floor(Math.random() * (999999 - 100000 + 1) + 100000)
      const resData = await sendOtp(phone, phone_otp)

      if (resData.data.type === 'success') {
        const isExists = await MobileVerificationModel.findOne({
          where: { mobile_number: phone.toString() }
        })
        if (isExists) {
          isExists.code = phone_otp
          isExists.is_verify = 'n'

          await isExists.save()
        } else {
          await MobileVerificationModel.create({
            mobile_number: phone,
            code: phone_otp,
            is_verify: 'n'
          })
        }
      }
      return res.send({ type: resData.data.type, message: resData.data.message, data: { json: resData.data } })
    } else {
      // const phone_otp = 111111
      const phone_otp = Math.floor(Math.random() * (999999 - 100000 + 1) + 100000)

      const resData = {}
      const otpResult = await sendOtpBangla(phone, phone_otp)
      resData.data = {}
      resData.data.type = (otpResult) ? 'success' : null
      if (resData.data.type === 'success') {
        const isExists = await MobileVerificationModel.findOne({
          where: { mobile_number: phone.toString() }
        })
        if (isExists) {
          isExists.code = phone_otp
          isExists.is_verify = 'n'

          await isExists.save()
        } else {
          await MobileVerificationModel.create({
            mobile_number: phone,
            code: phone_otp,
            is_verify: 'n'
          })
        }
      }
      return res.send({ type: 'success', message: messages[req.userLanguage].success, data: { json: '' } })
    }
  } catch (error) {
    catchError('userController.getRegisterPhoneVerifyV2', error, req, res)
  }
}
// ---------------------------------------------------------testAdharInfo start ------------------------------------------------
const adhar_info = async function (req, res) {
  const pan_response = await axios({
    method: 'post',
    // url: 'https://api.cashfree.com/verification/pan',
    url: 'https://api.cashfree.com/verification/offline-aadhaar/otp',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-version': '2022-10-26',
      'x-cf-signature': keys.cashfree_vssuite_signature,
      'x-client-id': keys.cashfree_vssuite_client_id,
      'x-client-secret': keys.cashfree_vssuite_secret_id,
      'x-request-id':'req123id'
    },
    data: {"aadhaar_number":'235670590009'}
  })
  var pan_data = pan_response.data
  //return pan_data;
  return res.send({ type: types.success, message: pan_data })
  }
// ---------------------------------------------------------testAdharInfo start ------------------------------------------------
// ---------------------------------------------------------testPanBankInfo start ------------------------------------------------


const testPanInfo = async (req, res) => {
    console.log(`in testPanInfo function.... 2255`);
    try {
      let { pan_no } = req.body
      const pan = pan_no
      const myObj = await axios({
        method: 'post',
        url: 'https://payout-api.cashfree.com/payout/v1/authorize',
        headers: {
          accept: 'application/json',
          'X-Cf-Signature': keys.cashfree_vssuite_signature,
          'X-Client-Secret': keys.cashfree_vssuite_secret_id,
          'X-Client-Id': keys.cashfree_vssuite_client_id
        }
      })
      const ob_j = myObj.data;
  
      const bank_response = await axios({
        method: 'GET',
        url: `https://payout-api.cashfree.com/payout/v1/asyncValidation/bankDetails?name=${bank_ac_name}&phone=8349102770&bankAccount=${ac_no}&ifsc=${ifsc}&remarks=Bank A/C Verification`,
        headers: {
          accept: 'application/json',
          Authorization: 'Bearer '+ob_j.data.token,
          'Content-Type': 'application/json'
        }
      })
      const val_data = bank_response.data;
      if (val_data.data != '' || val_data.data != null || val_data.data != 'undefined' || val_data.data != undefined) {
        const verification_status = await axios({
          method: 'GET',
          url: `https://payout-api.cashfree.com/payout/v1/getValidationStatus/bank?bvRefId=${val_data.data.bvRefId}&userId=fsdfsd`,
          headers: {
            accept: 'application/json',
            Authorization: 'Bearer '+ob_j.data.token,
            'Content-Type': 'application/json'
          }
        })
        const verification_data = verification_status.data;
        return res.send({ type: types.success, message: verification_data })
      } else {
        return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
      }
    } catch (error) {
      catchError('userController.getPhoneOtpVerify', error, req, res)
    }
}
    

// ------------------------------------------------testBankInfo--------------------------------------
const testBankInfo = async (req, res) => {
  console.log(`in line no. 2481...`);
  try {
    //const find_data = await UsersModel.findOne({ _id: 1216035 });
    
    // return res.send({ type: types.success, message: 'userController testBankInfo function.....', data: { message: 'userController testBankInfo function.....', type: types.success } })
    let { branch_name, bank_name, bank_ac_name, ac_no, ifsc, user_id, phone_no } = req.body
    branch_name = branch_name.replace(/(<([^>]+)>)/ig, '')
    bank_name = bank_name.replace(/(<([^>]+)>)/ig, '')
    //bank_name = bank_name + '-' + branch_name
    bank_ac_name = bank_ac_name.replace(/(<([^>]+)>)/ig, '')
    ac_no = ac_no.replace(/(<([^>]+)>)/ig, '')
    ifsc = ifsc.replace(/(<([^>]+)>)/ig, '')
    user_id = req.user.id
    phone_no = find_data.phone
    console.log("...LINE NUMBER 2497.....");
    console.log(ifsc);
    console.log("...LINE NUMBER 2499.....");
    // let { branch_name, bank_name, bank_ac_name, ac_no, ifsc } = req.body
    // branch_name = 'Kolkata'
    // bank_name = 'YES Bank'
    // bank_name = bank_name + '-' + branch_name
    // bank_ac_name = 'Harshit'
    // ac_no = '026291800001191'
    // ifsc = 'YESB0000262'
    // phone_no = '9798152633'
    // exit();
    const myObj = await axios({
      method: 'post',
      url: 'https://payout-api.cashfree.com/payout/v1/authorize',
      headers: {
        accept: 'application/json',
        'X-Cf-Signature': keys.cashfree_vssuite_signature,
        'X-Client-Secret': keys.cashfree_vssuite_secret_id,
        'X-Client-Id': keys.cashfree_vssuite_client_id
      }
    })
    const ob_j = myObj.data;
    const ob_j_val = myObj.headers;
    var obj_data = JSON.stringify(ob_j_val);
    //console.log(`in line no. 2333... ${obj_data}`);




    const response = await axios.get(`https://payout-api.cashfree.com/payout/v1/asyncValidation/bankDetails?bankAccount=${ac_no}&ifsc=${ifsc}&name=${bank_name}&phone=${phone_no}`, {
      headers: {
        'X-Client-Id': 'YOUR_CLIENT_ID',
        'X-Client-Secret': 'YOUR_CLIENT_SECRET',
        'Content-Type': 'application/json'
      }
    });
    
    console.log("....LINE NUMBER 2529...");
    console.log(response.data);
    console.log("....LINE NUMBER 2531...");

    const { bvRefId } = response.data.data;

    res.json({ bvRefId });




    const bank_response = await axios({
      method: 'GET',
      url: `https://payout-api.cashfree.com/payout/v1/asyncValidation/bankDetails?name=${bank_ac_name}&phone=${phone_no}&bankAccount=${ac_no}&ifsc=${ifsc}&remarks=Bank A/C Verification?userId=${user_id}`,
      headers: {
        accept: 'application/json',
        Authorization: 'Bearer '+ob_j.data.token,
        'Content-Type': 'application/json'
      }
    })
    var bank_details = JSON.stringify(bank_response.data);



    console.log("line number 2527");
    console.log(bank_response);
    console.log("line number 2529");
    console.log(`in line no. 2343... ${bank_details}`);
    const val_data = bank_response.data;
    if (val_data.data != '' || val_data.data != null || val_data.data != 'undefined' || val_data.data != undefined) {
      const verification_status = await axios({
        method: 'GET',
        url: `https://payout-api.cashfree.com/payout/v1/getValidationStatus/bank?bvRefId=${val_data.data.bvRefId}&userId=fsdfsd`,
        headers: {
          accept: 'application/json',
          Authorization: 'Bearer '+ob_j.data.token,
          'Content-Type': 'application/json'
        }
      })
      console.log(`in line no. 2355... `);
      const verification_data = verification_status.data;
      return res.send({ type: types.success, message: verification_data })
    } else {
      console.log(`in line no. 2359... `);
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].error })
    }
  } catch (error) {
    console.log(`in line no. 2363... `);
    catchError('userController.getPhoneOtpVerify', error, req, res)
  }
}


// ---------------------------------------------------------testPanBankInfo end ------------------------------------------------
const getPhoneOtpVerify = async (req, res) => {
  try {
    let { phone_otp, phone } = req.query
    phone = phone.toString()

    const mv = await MobileVerificationModel.findOne({
      where: {
        [Op.and]: [
          { mobile_number: phone },
          { mobile_number: { [Op.ne]: '' } },
          { code: phone_otp },
          { code: { [Op.ne]: '' } },
          { is_verify: 'n' }
        ]
      }
    })

    if (mv) {
      mv.is_verify = 'y'
      await mv.save()

      return res.send({ type: types.success, message: messages[req.userLanguage].otp_verified_succ, data: { message: 'otp_verified', type: types.success } })
    } else {
      return res.send({ type: types.error, message: messages[req.userLanguage].otp_not_valid, data: { message: 'invalid_otp', type: types.error } })
    }
  } catch (error) {
    catchError('userController.getPhoneOtpVerify', error, req, res)
  }
}



const otpVerifyEmail = async (req, res) => {
  try {
    const { otp, email } = req.body
    const user = await UsersModel.findOne({
      where: { id: req.user.id }
    })

    const email_otp = otp

    if (email_otp === user.email_code) {
      const existEmail = await UsersModel.findOne({
        where: { email }
      })
      if (existEmail && user.email !== email) return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].email_exists })

      user.email = email
      user.email_verify = '1'
      user.email_code = ''

      await user.save()
      return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Email address') })
    } else {
      return res.status(status.BadRequest).jsonp({ type: types.error, message: messages[req.userLanguage].otp_not_valid })
    }
  } catch (error) {
    catchError('userController.postSaveAuthNewEmail', error, req, res)
  }
}



const getLeaderShipBoard = async (req, res) => { // done
  try {
    const s3ParamsMonth = { Bucket: keys.awsS3Bucket, Key: 'elewk/json/month.json' }
    const s3ParamsAll = { Bucket: keys.awsS3Bucket, Key: 'elewk/json/overall.json' }
    const s3ParamsSeason = { Bucket: keys.awsS3Bucket, Key: 'elewk/json/season.json' }
    let monthdata
    let overalldata
    let seasondata = []
    s3.getObject(s3ParamsMonth, function (errMonth, month) {
      if (errMonth) console.log(errMonth)
      if (month) monthdata = JSON.parse(Buffer.from(month.Body).toString('utf8'))
      s3.getObject(s3ParamsAll, function (errAll, overall) {
        if (errAll) console.log(errAll)
        if (overall) overalldata = JSON.parse(Buffer.from(overall.Body).toString('utf8'))
        s3.getObject(s3ParamsSeason, function (errSeason, season) {
          if (errSeason) console.log(errSeason)
          if (season) seasondata = JSON.parse(Buffer.from(season.Body).toString('utf8'))

          return res.status(status.OK).jsonp({
            type: types.success,
            message: messages[req.userLanguage].success,
            data: { monthdata, overalldata, seasondata }
          })
        })
      })
    })
  } catch (error) {
    catchError('userController.getLeaderShipBoard', error, req, res)
  }
}



const rummyUserExists = async function (req, res) {
  try {
    const { phone } = req.body
    const user = await UsersModel.findOne({
      where: { phone: phone.toString() },
      attributes: ['id', 'email', 'phone', 'username', 'email_verify', 'phone_verify']
    })

    if (user) {
      if (parseInt(user.email_verify) && parseInt(user.phone_verify)) {
        return res.status(status.OK).send({ type: types.success, message: messages[req.userLanguage].fetched_succ.replace('##', 'User') })
      } else {
        return res.status(status.NotFound).send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'User') })
      }
    } else {
      return res.status(status.NotFound).send({ type: types.error, message: messages[req.userLanguage].not_found.replace('##', 'User') })
    }
  } catch (error) {
    return catchError('userController.rummyUserExists', error, req, res)
  }
}



const viewWalletInfo = async function (req, res) { 
  try {
    const user = await UserPaymentMethodModel.findOne({
      where: { user_id: req.user.id },
      attributes: ['bikash_acc', 'nagad_acc', 'rocket_acc', 'user_id']
    })
    return res.send({ type: types.success, message: messages[req.userLanguage].fetched_succ.replace('##', 'Details'), data: user })
  } catch (error) {
    return catchError('userController.viewWalletInfo', error, req, res)
  }
}



const editWalletInfo = async function (req, res) {
  try {
    req.body = pick(req.body, ['bikash_acc', 'nagad_acc', 'rocket_acc'])
    removenull(req.body)
    const { bikash_acc, nagad_acc, rocket_acc } = req.body
    if ((bikash_acc && nagad_acc) || (nagad_acc && rocket_acc) || (rocket_acc && bikash_acc)) {
      return res.send({ message: messages[req.userLanguage].try_again, data: {} })
    }

    const isExists = await UserPaymentMethodModel.findOne({
      where: { user_id: req.user.id }
    })

    if (isExists) {
      if (bikash_acc && isExists.bikash_acc) {
        return res.send({ message: messages[req.userLanguage].update_op_not_allowed, data: {} })
      } else if (nagad_acc && isExists.nagad_acc) {
        return res.send({ message: messages[req.userLanguage].update_op_not_allowed, data: {} })
      } else if (rocket_acc && isExists.rocket_acc) {
        return res.send({ message: messages[req.userLanguage].update_op_not_allowed, data: {} })
      }

      req.body.updated_at = getFiveThirtyPlusDate()
      await UserPaymentMethodModel.update(
        req.body,
        {
          where: {
            user_id: req.user.id
          }
        }
      )
    } else {
      await UserPaymentMethodModel.create({
        ...req.body, user_id: req.user.id
      })
    }
     return res.send({ type: types.success, message: messages[req.userLanguage].updated_succ.replace('##', 'Wallet') })
  } catch (error) {
     return catchError('userController.editWalletInfo', error, req, res)
  }
}



module.exports = {
  editProfile,
  myProfileV2,
  editBankInfo,
  editPhone,
  verifyOtp,
  changePassword,
  register,
  activateEmail,
  socialRegisterNew,
  login,
  userDashboard,
  viewBankInfo,
  viewDocument,
  emailSendCode,
  emailPhoneExists,
  changeCurrentPassword,
  myContestAndMatchesCount,
  submitInstantWithdraw,
  getSignedUrl,
  updateImagePath,
  updateKycDetails,
  changePhone,
  changeEmail,
  getRegisterPhoneVerifyV2,
  getPhoneOtpVerify,
  otpVerifyEmail,
  getLeaderShipBoard,
  rummyUserExists,
  viewWalletInfo,
  editWalletInfo,
  updateImagePathV2,
  viewDocumentV2,
  registerV2,
  testBankInfo,
  testPanInfo
}
