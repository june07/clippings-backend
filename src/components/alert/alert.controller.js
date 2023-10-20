const alertService = require('./alert.service')

async function createAlert(params, socket) {
    const { listingPid, from, to, sendAt } = params
    const owner = socket.sessionId

    const alert = await alertService.createAlert(owner, listingPid, from, to, sendAt)
    
    if (alert instanceof Error) {
        socket.emit(alert.message)
    } else {
        socket.emit('alertCreated', alert)
    }
}
async function readAlerts(socket, callback) {
    const owner = socket.sessionId

    const alerts = await alertService.readAlerts(owner)
    
    callback(alerts)
}
async function updateAlert(params, socket) {
    const { _id, owner, listingPid, from, to, sendAt } = params

    if (owner !== socket.sessionId) {
        socket.emit(new Error(`can't update a alert owned by someone else.`))
        return
    }

    const alert = await alertService.updateAlert(_id, owner, listingPid, from, to, sendAt)
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