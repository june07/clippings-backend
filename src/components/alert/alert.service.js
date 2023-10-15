const { default: mongoose } = require('mongoose')
const AlertModel = require('./alert.model')

async function setEmergencyAlert(listingPid, from, to, sendAt) {

    const alertObj = {
        createdAt: new Date(),
        listingPid,
        from: from instanceof mongoose.Types.ObjectId ? from : {
            _id: new mongoose.Types.ObjectId(),
            ...from
        },
        to: to.map(to => to instanceof mongoose.Types.ObjectId ? to : {
            _id: new mongoose.Types.ObjectId(),
            ...from
        }),
        sendAt
    }
    const alert = await AlertModel.findOneAndUpdate({ listingPid }, alertObj, { lean: true, new: true, upsert: true })
    return alert
}

module.exports = {
    setEmergencyAlert
}