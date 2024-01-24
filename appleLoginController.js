/* eslint-disable prefer-promise-reject-errors */
const jwt = require('jsonwebtoken')
const NodeRSA = require('node-rsa')
const axios = require('axios')
const TOKEN_ISSUER = 'https://appleid.apple.com'

const getApplePublicKey = async kid => {
  try {
    const { data } = await axios.get('https://appleid.apple.com/auth/keys')
    const { keys } = data
    const key = keys.find(k => k.kid === kid)
    const pubKey = new NodeRSA()
    pubKey.importKey({ n: Buffer.from(key.n, 'base64'), e: Buffer.from(key.e, 'base64') }, 'components-public')
    return pubKey.exportKey(['public'])
  } catch (error) {
    console.error(error)
    return null
  }
}

const verifyIdToken = async (idToken) =>
  new Promise(async (resolve, reject) => {
    try {
      const decodedToken = jwt.decode(idToken, { complete: true })
      const applePublicKey = await getApplePublicKey(decodedToken.header.kid)
      if (!applePublicKey) return reject('No Public key')
      const jwtClaims = jwt.verify(idToken, applePublicKey, { algorithms: 'RS256' })
      if (jwtClaims.iss !== TOKEN_ISSUER) return reject(`id token not issued by correct OpenID provider - expected: ${TOKEN_ISSUER} | from: ${jwtClaims.iss}`)
      if (jwtClaims.exp < Date.now() / 1000) return reject('id token has expired')
      return resolve(jwtClaims)
    } catch (error) {
      console.log(error.toString())
      reject(error)
    }
  })

module.exports = {
  verifyIdToken
}
