const mongoose = require('mongoose')

const alertSchema = new mongoose.Schema({
    createdAt: Date,
    listingPid: Number,
    from: { type: mongoose.Schema.Types.Mixed, ref: 'Contact' },
    to: [{ type: mongoose.Schema.Types.Mixed, ref: 'Contact' }],
    sendAt: Date
}).index({ listingPid: 1, from: 1 })

module.exports = mongoose.model('Alert', alertSchema)
