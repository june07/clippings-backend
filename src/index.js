require('dd-trace').init()
const mongoose = require('mongoose')
const inspector = require('node:inspector')
const { Server } = require('socket.io')
const https = require('https')
const fs = require('fs')

const app = require('./app')
const logger = require('./config/logger')
const config = require('./config/config')
const ioRouter = require('./routes/v1/io.routes')
const { MessageModel } = require('./components/message')

const namespace = 'clippings-backend:index'

mongoose.connect(config.MONGODB_URI).then(() => {
    logger.info('Connected to MongoDB')

    MessageModel.create({
        owner: 'system',
        title: 'default alert message',
        text: `I am lost and my last known action was going to visit someone from this online classified ad...`
    }).catch(error => {
        if (error.code != 11000) {
            logger.error({ namespace, message: error.message })
        }
    })
})

const server = https.createServer({
    key: fs.readFileSync('./cert.pem', 'utf8'),
    cert: fs.readFileSync('./cert.pem', 'utf8'),
}, app)
server.listen(config.PORT, () => {
    console.log(`listening on ${config.PORT}`)
})
const io = new Server(server, {
    cors: {
        credentials: true,
        origin: config.CORS_DOMAINS.split(' ')
    },
    maxPayload: 10e6,
    maxHttpBufferSize: 10e6,
    cookie: {
        name: "io",
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        domain: config.COOKIE_DOMAIN
    }
})
io.use((socket, next) => {
    const sessionId = socket.handshake.auth.sessionId
    if (sessionId) {
        // find existing session
        app.sessionStore.get(sessionId, (error, session) => {
            if (error) {
                logger.error({ namespace, message: error.message || error })
            }
            if (session) {
                socket.sessionId = sessionId
                next()
            } else {
                next(new Error('no matching sesssionId found'))
            }
        })
    } else {
        next(new Error('no sesssionId provided'))
    }
})
io.on('connection', (socket) => {
    logger.info(`Socket.io connection is established`)
})
ioRouter(io)

const exitHandler = () => {
    if (server) {
        server.close(() => {
            logger.info('Server closed')
            process.exit(1)
        })
    } else {
        process.exit(1)
    }
}

const unexpectedErrorHandler = (error) => {
    logger.error(error)
    exitHandler()
}

process.on('uncaughtException', unexpectedErrorHandler)
process.on('unhandledRejection', unexpectedErrorHandler)

process.on('SIGUSR2', () => {
    logger.info('SIGUSR2 received')
    if (server) {
        server.close()
        inspector.close()
        // process.exit(1)
    }
})
