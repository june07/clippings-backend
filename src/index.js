require('dd-trace').init()
const inspector = require('node:inspector')
const { Server } = require('socket.io')
const https = require('https')
const app = require('./app')
const logger = require('./config/logger')
const config = require('./config/config')
const httpStatus = require('http-status')
const ioRouter = require('./routes/v1/io.routes')
const fs = require('fs')
const routes = require('./routes/v1')
const { ApiError } = require('./utils')

const server = https.createServer({
    key: fs.readFileSync('./cert.pem', 'utf8'),
    cert: fs.readFileSync('./cert.pem', 'utf8'),
}, app)
server.listen(config.PORT, () => {
    console.log(`listening on ${config.PORT}`)
})
const io = new Server(server, {
    path: '/ws',
    cors: {
        credentials: true,
        origin: config.CORS_DOMAINS.split(' ').map(
            (domain) => `https://${config.NODE_ENV === 'production' ? '' : 'dev.'}${domain}`
        ),
    },
    maxPayload: 10e6,
    maxHttpBufferSize: 10e6
})
io.engine.use(app.sessionMW)
io.on('connection', () => {
    logger.info(`Socket.io connection is established`)
})
ioRouter(io)

app.use((req, _res, next) => {
    req.io = io
    next()
})
// v1 api routes
app.use('/v1', routes)

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
    next(new ApiError(httpStatus.NOT_FOUND, 'Not found'))
})

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
