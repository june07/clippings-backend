require('dd-trace').init()
const inspector = require('node:inspector')
const { Server } = require('socket.io')
const https = require('https')
const fs = require('fs')

const app = require('./app')
const logger = require('./config/logger')
const config = require('./config/config')
const ioRouter = require('./routes/v1/io.routes')

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
        secure: true
    }
})
io.use((socket, next) => {
    const sessionId = socket.handshake.auth.sessionId
    if (sessionId) {
        // find existing session
        app.sessionStore.get(sessionId, (error, session) => {
            if (session) {
                socket.sessionId = sessionId
                next()
            } else {
                next('no sesssion')
            }
        })
    } else {
        next('no session')
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
