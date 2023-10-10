const { v5: uuidv5 } = require('uuid')

const redis = require('../../config/redis')
const logger = require('../../config/logger')
const { crawlerService } = require('../../components/crawler')
const { githubService } = require('../../components/github')

const namespace = 'jc-backend:routes:io'

function router(io) {
    logger.info({ namespace, message: 'Setting up io routes...' })
    io.of('/').on('connection', socket => {
        const clientId = `${socket.request.headers['x-forward-for']}_${socket.sessionId}`

        socket.on('archive', async (listingURL) => {
            const listingUUID = uuidv5(listingURL, uuidv5.URL)
            const listingPid = listingURL.match(/\/([^\/]*)\.htm/)[1]

            socket.craigslist = { listingPid, listingURL, listingUUID, clientId }

            const { emitter } = await crawlerService.archive(socket.craigslist)
            emitter.on('archived', payload => {
                socket.emit('update', payload)
            })
        }).on('getArchive', async (listingPid, callback) => {
            if (!listingPid.match(/\d{10}/)?.[0]) {
                callback(new Error('invalid pid'))
                return
            }
            const archive = await redis.HGET('archives', listingPid)
            callback(archive)
        }).on('getMostRecentListingPids', async (callback) => {
            const pids = await redis.LRANGE('recent_listings', 0, 10)
            callback(pids)
        }).on('updateDiscussion', async (giscusDiscussion) => {
            const { id, totalCommentCount } = giscusDiscussion

            const commentData = await githubService.getCommentData(id)
            if (commentData?.title) {
                socket.broadcast.emit('updatedDiscussion', commentData)
                await redis.HSET('commented', commentData.title, totalCommentCount) // commentData.title === pid
            }
        }).on('disconnect', async (reason) => {
            logger.info({ namespace, message: reason })
        })
    })
}

module.exports = router

process.on('SIGUSR2', async () => {
    const socketsKeys = await redis.KEYS(`clients-*`)
    await Promise.all([
        ...socketsKeys.map(key => redis.DEL(key, 0, -1))
    ])
})