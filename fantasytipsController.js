const FantasyTips = require('./../models/fantasytips.model')
const { catchError, messages, status, types } = require('./../api.response')
const {
  models: {
    season_matches: SeasonMatchesModel
  }
} = require('../services/sqlConnect')
const axios = require('axios')
const { parse } = require('node-html-parser')

const storePost = async (req, res) => {
  try {
    const postData = await axios.get(`https://crictracker.com/wp-json/wp/v2/posts/${req.body.post_id}`)
    const storedPost = await FantasyTips.findOne({ id: postData.data.id })

    postData.data.content.rendered = postData.data.content.rendered.replace('<p>Advertisement</p>', '')

    const root = parse(postData.data.content.rendered)

    root.childNodes = root.childNodes.filter(s => {
      return !(s.classNames && s.classNames.includes('similar-posts')) // remove similar posts div
    })
    root.childNodes = root.childNodes.filter(s => {
      return !(s.classNames && s.classNames.includes('also-read-title')) // remove also read title
    })

    if (!storedPost) {
      const newPost = new FantasyTips({
        id: postData.data.id,
        date: postData.data.date,
        modified: postData.data.modified,
        slug: postData.data.slug,
        status: postData.data.status,
        link: postData.data.link,
        title: postData.data.title.rendered,
        content: root.toString(),
        excerpt: postData.data.excerpt.rendered,
        author: postData.data.author,
        featured_media: postData.data.featured_media,
        categories: postData.data.categories,
        tags: postData.data.tags,
        dUpdatedAt: Date.now()
      })

      await newPost.save()
    }

    await SeasonMatchesModel.update({
      post_id: req.body.post_id
    }, {
      where: { id: req.body.match_id }
    })
    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].success })
  } catch (error) {
    catchError('fantasytips.storePost', error, req, res)
  }
}

const updatePost = async (req, res) => {
  try {
    const match = await SeasonMatchesModel.findOne({
      where: { post_id: req.params.id }
    })

    if (match) {
      const postData = await axios.get(`https://crictracker.com/wp-json/wp/v2/posts/${req.params.id}`)
      let post = await FantasyTips.findOne({ id: req.params.post_id })
      postData.data.content.rendered = postData.data.content.rendered.replace('<p>Advertisement</p>', '')

      const root = parse(postData.data.content.rendered)

      root.childNodes = root.childNodes.filter(s => {
        return !(s.classNames && s.classNames.includes('similar-posts')) // remove similar posts div
      })
      root.childNodes = root.childNodes.filter(s => {
        return !(s.classNames && s.classNames.includes('also-read-title')) // remove also read title
      })

      if (post) {
        post.id = postData.data.id
        post.date = postData.data.date
        post.modified = postData.data.modified
        post.slug = postData.data.slug
        post.status = postData.data.status
        post.link = postData.data.link
        post.title = postData.data.title.rendered
        post.content = root.toString()
        post.excerpt = postData.data.excerpt.rendered
        post.author = postData.data.author
        post.featured_media = postData.data.featured_media
        post.categories = postData.data.categories
        post.tags = postData.data.tags
        post.dUpdatedAt = Date.now()
      } else {
        post = new FantasyTips({
          id: postData.data.id,
          date: postData.data.date,
          modified: postData.data.modified,
          slug: postData.data.slug,
          status: postData.data.status,
          link: postData.data.link,
          title: postData.data.title.rendered,
          content: postData.data.content.rendered,
          excerpt: postData.data.excerpt.rendered,
          author: postData.data.author,
          featured_media: postData.data.featured_media,
          categories: postData.data.categories,
          tags: postData.data.tags,
          dUpdatedAt: Date.now()
        })
      }
      await post.save()
    }

    return res.status(status.OK).jsonp({ type: types.success, message: messages[req.userLanguage].OK })
  } catch (error) {
    catchError('fantasytips.updatePost', error, req, res)
  }
}

const getPost = async (req, res) => {
  try {
    const post = await FantasyTips.findOne({ id: req.params.id }, { title: 1, content: 1, slug: 1 })
    return res.status(status.OK).jsonp({ type: types.success, data: post })
  } catch (error) {
    catchError('fantasytips.getPost', error, req, res)
  }
}

module.exports = {
  storePost,
  updatePost,
  getPost
}
