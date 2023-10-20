const AlertModel = require('./alert.model')

async function createAlert(owner, listingPid, from, to, sendAt) {
    try {
        const alert = await AlertModel.create({
            owner,
            listingPid,
            from,
            to,
            sendAt
        })
        return alert
    } catch (error) {
        return error
    }
}
async function readAlerts(owner) {
    const alerts = await AlertModel.find({ owner }, { '__v': 0 }, { lean: true })
    return alerts
}
async function updateAlert(_id, owner, listingPid, from, to, sendAt) {
    const alertObj = {
        owner,
        listingPid,
        from,
        to,
        sendAt
    }
    const alert = await AlertModel.findOneAndUpdate({ _id }, alertObj, { lean: true, new: true, upsert: true })
    return { ...alert, _id: alert._id.toString() }
}
async function deleteAlert(_id) {
    await AlertModel.findByIdAndDelete(_id)
}

module.exports = {
    readAlerts,
    createAlert,
    updateAlert,
    deleteAlert
}