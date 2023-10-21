const redis = require('../../config/redis')
const AlertModel = require('./alert.model')
const { mailService } = require('../../common/services')
const logger = require('../../config/logger')
const namespace = 'clippings-backend:alert:service'

async function createAlert(owner, listingPid, from, to, message, sendAt) {
    try {
        const alert = await AlertModel.create({
            owner,
            listingPid,
            from,
            to,
            message,
            sendAt
        })
        return alert
    } catch (error) {
        return error
    }
}
async function readAlerts(owner) {
    const alerts = await AlertModel.find({ owner }, { '__v': 0 }, { lean: true })
        .populate({
            path: 'to',
            select: { '__v': 0 }
        })
        .populate({
            path: 'message',
            select: { '__v': 0 }
        })
    return alerts
}
async function updateAlert(_id, owner, listingPid, from, to, message, sendAt) {
    const alertObj = {
        owner,
        listingPid,
        from,
        to,
        message,
        sendAt
    }
    const alert = await AlertModel.findOneAndUpdate({ _id }, alertObj, { lean: true, new: true, upsert: true })
    return { ...alert, _id: alert._id.toString() }
}
async function deleteAlert(_id) {
    const alert = await AlertModel.findById(_id)
    if (!alert.receipt) {
        await alert.deleteOne()
    }
}
async function cacheAlerts(timeRangeMs = 0) {
    const alerts = await AlertModel.find({ sendAt: { $gte: Date.now() - timeRangeMs } }, { '__v': 0 }, { lean: true })
        .populate({
            path: 'to',
            select: { '__v': 0 }
        })
        .populate({
            path: 'message',
            select: { '__v': 0 }
        })
    await redis.SET('alerts', JSON.stringify(alerts), { EX: 3600 })
}
async function sendAlerts() {
    const alertsJSON = await redis.GET('alerts')

    if (!alertsJSON) return
    const alerts = JSON.parse(alertsJSON)
    const alertsToSend = alerts.filter(alert => Date.parse(alert.sendAt) <= Date.now() && !alerts.receipt)

    alertsToSend.map(alert => {
        const contactsToEmail = alert.to.filter(contact => contact.email)
        const contactsToSMS = alert.to.filter(contact => contact.phone)

        if (contactsToEmail.length) {
            mailService.sendAlert(contactsToEmail, alert, async (sentAlert) => {
                const p1 = AlertModel.findOneAndUpdate({ _id: sentAlert._id }, sentAlert)
                const index = alerts.findIndex(alert => alert._id === sentAlert._id)
                
                if (index !== -1) {
                    alerts[index] = sentAlert
                    await Promise.all([
                        p1,
                        redis.SET('alerts', JSON.stringify(alerts))
                    ])
                } else {
                    await p1
                }

                logger.info({ namespace, message: `sent alert ${sentAlert._id}` })
            })
        }
        if (contactsToSMS.length) {
            // handle this later
        }
    })
}

module.exports = {
    readAlerts,
    createAlert,
    updateAlert,
    deleteAlert,
    cacheAlerts,
    sendAlerts
}