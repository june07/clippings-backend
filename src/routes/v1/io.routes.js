const debug = require('debug')(`jc-backend:routes:v1:io.routes`)
const { hostname } = require('os')
const { until } = require('async')
const { customAlphabet } = require('nanoid')
const shortCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 3)
const { v5: uuidv5 } = require('uuid')
const cookie = require('cookie')

const logger = require('../../config/logger')
const { crawlerService } = require('../../components/crawler')
const redis = require('../../config/redis')

let local = {
    intervals: {}
}

function router(io) {
    console.log('Setting up io routes...')
    io.of('/').on('connection', socket => {
        const cookies = cookie.parse(socket.handshake.headers.cookie)
        const sessionId = cookies['connect.sid']?.match(/s:([^\.]*)/)[1] || 'nosession'

        socket.send('connected to / endpoint')
        socket.on('get', async (url, callback) => {
            const uuid = uuidv5(url, uuidv5.URL)
            const { nocache } = socket.handshake.query
            const updateEmitterName = `update-${uuid}`
            const redisSessionsPerUUIDKey = `sessions-${hostname()}-${uuid}`

            socket.craigslist = { url, uuid, nocache, sessionId }

            const { json, isCached, emitter } = await crawlerService.get(socket.craigslist)
            if (json) {
                callback({ json, isCached })
            }
            if (!emitter._events[updateEmitterName]) {
                emitter.on(updateEmitterName, payload => {
                    if ((payload.json?.uuid || payload.diff?.uuid) === uuid) {
                        if (payload.diff) delete payload.json
                        if (payload.diff?.listings && Object.keys(payload.diff.listings).length) {
                            socket.nsp.emit('update', payload)
                        }
                    }
                })
            }
            if (!await redis.SMEMBERS(redisSessionsPerUUIDKey).length) {
                redis.SADD(redisSessionsPerUUIDKey, sessionId)
                const cachedIntervalId = await redis.HGET(`intervalIds-${hostname()}`, uuid)
                if (!cachedIntervalId) {
                    if (local.intervals[cachedIntervalId]) {
                        clearInterval(cachedIntervalId)
                        logger.log(`cleared local interval that didn't exist in redis!`)
                    }
                    const interval = setInterval(() => {
                        console.log(`${new Date().toLocaleTimeString()}: running interval for redisSessionsPerUUIDKey: ${redisSessionsPerUUIDKey}, sessionId: ${sessionId}`)
                        crawlerService.get({
                            ...socket.craigslist,
                            nocache: true
                        })
                    }, 60000)
                    const intervalId = interval[Symbol.toPrimitive]()
                    local.intervals[intervalId] = new Date().toLocaleString()
                    redis.HSET(`intervalIds-${hostname()}`, uuid, intervalId)
                }
            }
        }).on('sync', (remoteState) => {
            if (remoteState) {
                socket.broadcast.emit('remoteState', remoteState)
            } else {
                socket.broadcast.emit('sync')
            }
        }).on('relink', async (code, callback) => {
            socket.join(code)
            callback(`relinked with code ${code}`)
        }).on('unlink', async (code, callback) => {
            const sid = socket.request.session.id
            const primarySId = await redis.GET(`linkCodes-${code}`)

            if (primarySId) {
                const cachedCode = await redis.HGET(primarySId, 'linkCode')
                if (cachedCode === code) {
                    redis.HDEL(primarySId, sid)
                    socket.leave(code)
                    callback(`unlinked with code ${code}`)
                } else {
                    callback('bad code')
                }
            } else {
                callback('bad code')
            }
        }).on('link', async (callback) => {
            const sid = socket.request.session.id
            let code = await redis.HGET(sid, 'linkCode')

            if (!code) {
                await until(
                    async callback => {
                        code = shortCode()
                        const cachedCode = await redis.GET(`linkCodes-${code}`)
                        callback(null, !cachedCode)
                    },
                    () => { },
                    async () => {
                        const multi = redis.multi()
                        multi.SET(`linkCodes-${code}`, sid)
                        multi.HSET(sid, 'linkCode', code)
                        await multi.exec()
                    }

                )
            }

            socket.join(code)
            callback(code)
        }).on('linked', async (code, callback) => {
            const sid = socket.request.session.id
            const primarySId = await redis.GET(`linkCodes-${code}`)

            if (primarySId) {
                const cachedCode = await redis.HGET(primarySId, 'linkCode')
                if (cachedCode === code) {
                    redis.HSET(primarySId, sid, new Date().toISOString())
                    socket.join(code)
                    callback(`device linked with code ${code}`)
                    socket.to(code).emit('linked', `device linked with code ${code}`)
                } else {
                    callback('bad code')
                }
            } else {
                callback('bad code')
            }
        }).on('audioQueue', async (queue) => {
            if (queue) {
                socket.broadcast.emit('audioQueue', queue)
            }
        })
            .on('disconnect', async (_reason) => {
                if (!socket?.craigslist?.uuid) return
                const { uuid, sessionId } = socket.craigslist
                const redisSessionsPerUUIDKey = `sessions-${hostname()}-${uuid}`

                await redis.SREM(redisSessionsPerUUIDKey, sessionId)
                const members = await redis.SMEMBERS(redisSessionsPerUUIDKey)
                /** some other factors should be considered before removing the search since alerts can still be received when offline */
                if (!members.length) {
                    const intervalId = await redis.HGET(`intervalIds-${hostname()}`, uuid)
                    if (local.intervals[intervalId]) {
                        clearInterval(intervalId)
                        delete local.intervals[intervalId]
                        redis.HDEL(`intervalIds-${hostname()}`, uuid)
                    }
                }
            })
    })
}

module.exports = router

process.on('SIGUSR2', async () => {
    const socketsKeys = await redis.KEYS(`sessions-${hostname()}-*`)
    await Promise.all([
        redis.DEL(`intervalIds-${hostname()}`),
        ...socketsKeys.map(key => redis.DEL(key, 0, -1))
    ])
})