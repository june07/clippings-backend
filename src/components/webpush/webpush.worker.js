const webpush = require('web-push')
const config = require('../../config/config')
const logger = require('../../config/logger')

class WebPushWorker {
    constructor() {
        webpush.setVapidDetails(`mailto:${config.WEBPUSH_EMAIL}`, config.WEBPUSH_PUBLIC_KEY, config.WEBPUSH_PRIVATE_KEY)
    }
    async sendNotice(source, notice) {
        const { webpushSubscription } = notice.user

        if (webpushSubscription) {
            const message = ''
            const response = await webpush.sendNotification(JSON.parse(webpushSubscription), message)
            logger.info(JSON.stringify(response))
        }
    }
}

module.exports = WebPushWorker
