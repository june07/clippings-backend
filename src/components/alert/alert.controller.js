const alertService = require('./alert.service')

async function createAlert(params, socket) {
    const { listingPid, from, to, message, sendAt } = params
    const owner = socket.request.sessionId || socket.request.session.id

    const alert = await alertService.createAlert(owner, listingPid, from, to, message, sendAt)
    
    if (alert instanceof Error) {
        socket.emit(alert.message)
    } else {
        socket.emit('alertCreated', alert)
    }
}
async function readAlerts(socket, callback) {
    const owner = socket.request.sessionId || socket.request.session.id

    const alerts = await alertService.readAlerts(owner)
    
    callback(alerts)
}
async function updateAlert(params, socket) {
    const { _id, owner, listingPid, from, to, message, sendAt } = params

    if (owner !== socket.request.sessionId || socket.request.session.id) {
        socket.emit(new Error(`can't update a alert owned by someone else.`))
        return
    }

    const alert = await alertService.updateAlert(_id, owner, listingPid, from, to, message, sendAt)
    socket.emit('alertUpdated', alert)
}
async function deleteAlert(params, socket) {
    const { _id } = params

    await alertService.deleteAlert(_id)
    socket.emit('alertDeleted', _id)
}

module.exports = {
    createAlert,
    readAlerts,
    updateAlert,
    deleteAlert
}