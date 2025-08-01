const { v5: uuidv5 } = require('uuid')

const redis = require('../../config/redis')
const logger = require('../../config/logger')
const { crawlerService } = require('../../components/crawler')
const { githubService } = require('../../components/github')
const { contactController, contactValidations } = require('../../components/contact')
const { messageController, messageValidations } = require('../../components/message')
const { alertController, alertValidations } = require('../../components/alert')
const { addContactToDailyList } = require('../../common/services/mail.service')
const { validatePayload, ownerFromSession } = require('../../middleware')

const namespace = 'clippings-backend:routes:io'

function router(io) {
    logger.log({ level: 'info', namespace, message: 'Setting up io routes...' })
    const mainNamespace = io.of('/').on('connection', async socket => {
        const clientId = `${socket.request.headers['x-forward-for'] || socket.request.connection.remoteAddress}_${socket.request.sessionId || socket.request.session.id}`

        socket.on('getEmergencyContacts', () => {
            ownerFromSession(socket, async (error) => {
                if (error) {
                    logger.error(error)
                    return error
                } else {
                    return await contactController.readContacts(socket)
                }
            })
        }).on('createContact', async (payload) => {
            validatePayload(payload, contactValidations.createContact, (error) => !error ? contactController.createContact(payload, socket) : logger.error(error))
        }).on('updateContact', async (payload) => {
            validatePayload(payload, contactValidations.updateContact, (error) => !error ? contactController.updateContact(payload, socket) : logger.error(error))
        }).on('deleteContact', async (payload) => {
            validatePayload(payload, contactValidations.deleteContact, (error) => !error ? contactController.deleteContact(payload, socket) : logger.error(error))
        }).on('optIn', async (payload, callback) => {
            validatePayload(payload, contactValidations.optIn, (error) => !error ? contactController.optIn(payload, callback) : logger.error(error))
        }).on('createMessage', async (payload) => {
            validatePayload(payload, messageValidations.createMessage, (error) => !error ? messageController.createMessage(payload, socket) : logger.error(error))
        }).on('getEmergencyMessages', async (payload) => {
            validatePayload(payload, messageValidations.readMessages, (error) => !error ? messageController.readMessages(payload, socket) : logger.error(error))
        }).on('updateMessage', async (payload) => {
            validatePayload(payload, messageValidations.updateMessage, (error) => !error ? messageController.updateMessage(payload, socket) : logger.error(error))
        }).on('deleteMessage', async (payload) => {
            validatePayload(payload, messageValidations.deleteMessage, (error) => !error ? messageController.deleteMessage(payload, socket) : logger.error(error))
        }).on('createAlert', async (payload) => {
            validatePayload(payload, alertValidations.createAlert, (error) => !error ? alertController.createAlert(payload, socket) : logger.error(error))
        }).on('readAlerts', async (payload, callback) => {
            validatePayload(payload, alertValidations.readAlerts, (error) => !error ? alertController.readAlerts(socket, callback) : logger.error(error))
        }).on('updateAlert', async (payload) => {
            validatePayload(payload, alertValidations.updateAlert, (error) => !error ? alertController.updateAlert(payload, socket) : logger.error(error))
        }).on('deleteAlert', async (payload) => {
            validatePayload(payload, alertValidations.deleteAlert, (error) => !error ? alertController.deleteAlert(payload, socket) : logger.error(error))
        }).on('getArchive', async (listingPid, callback) => {
            if (!listingPid.match(/\d{10}/)?.[0]) {
                callback(new Error('invalid pid'))
                return
            }
            let archive = await redis.HGET('archives', listingPid)

            if (!archive) {
                // get it from mongoose and maybe move it back to archives or a different cache?!
                archive = await redis.HGET('archives-older', listingPid)
            }
            callback(archive)
        }).on('archive', async (listingURL) => {
            const listingUUID = uuidv5(listingURL, uuidv5.URL)
            const listingPid = listingURL.match(/\/([^\/]*)\.htm/)[1]
            if (!listingPid) {
                return new Error('invalid pid')
            }
            // check to see if it's been done already
            const archive = await redis.HGET('archives', listingPid)
            if (archive) {
                socket.emit('update', { archived: JSON.parse(archive) })
                return
            }

            socket.craigslist = { listingPid, listingURL, listingUUID, clientId }

            const { emitter } = await crawlerService.archive(socket.craigslist)
            
            emitter.on('archived', async payload => {
                socket.emit('update', payload)
                const mostRecentListings = await redis.SMEMBERS('recent_listings')
                mainNamespace.emit('mostRecentListings', mostRecentListings)
            })
            emitter.on('error', error => {
                delete error.cause
                socket.emit('error', error.message)
            })
            emitter.on('vncReady', payload => {
                socket.emit('vncReady', payload)
            })
        }).on('getMostRecentListings', async (callback) => {
            const mostRecentListings = await redis.SMEMBERS('recent_listings')
            callback(mostRecentListings)
        }).on('getMostRecentDiscussions', async (options) => {
            const { last } = options

            const commentData = await githubService.getCommentData({ last })
            const pids = commentData.map(discussion => discussion.title)
            const archiveData = (await redis.HMGET('archives', pids)).filter(archive => archive)
            if (archiveData.length < last) {
                (await redis.HMGET('archives-older', pids)).filter(archive => archive).map(archive => archiveData.push(archive))
            }
            const data = commentData.map((discussion, index) => {
                if (archiveData[index] && JSON.parse(archiveData[index])?.listingURL) {
                    return { ...discussion, url: JSON.parse(archiveData[index]).listingURL }
                } else {
                    return discussion
                }
            })
            mainNamespace.emit('mostRecentDiscussions', data)
        }).on('updateDiscussion', async (giscusDiscussion) => {
            const { id, totalCommentCount } = giscusDiscussion

            const commentData = await githubService.getCommentData({ id })
            if (commentData?.title) {
                mainNamespace.emit('updatedDiscussion', commentData)
                await redis.HSET('commented', commentData.title, totalCommentCount) // commentData.title === pid
            }
        }).on('subscribe-daily', async (email, callback) => {
            const result = await addContactToDailyList(email)
            callback(result)
        }).on('disconnect', async (reason) => {
            logger.log({ level: 'info', namespace, message: reason })
        })


        ownerFromSession(socket, async (error) => {
            if (!error) {
                socket.emit('emergencyContact', {
                    contacts: error ? [] : await contactController.readContacts(socket),
                    messages: error ? [] : await messageController.readMessages(socket),

                })
            }
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