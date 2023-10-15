const alertService = require('./alert.service')

async function setEmergencyAlert(params, socket) {
    const { listingPid, from, to, sendAt } = params

    const alert = alertService.setEmergencyAlert(listingPid, from, to, sendAt)
    socket.emit('alert-set', alert)
}

module.exports = {
    setEmergencyAlert
}