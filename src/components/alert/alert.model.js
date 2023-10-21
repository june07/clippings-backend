const mongoose = require('mongoose')

const alertSchema = new mongoose.Schema({
    owner: { type: String, required: true },
    listingPid: Number,
    from: { type: mongoose.Schema.Types.Mixed, ref: 'Contact' },
    to: [{ type: mongoose.Schema.Types.Mixed, ref: 'Contact' }],
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    sendAt: Date,
    receipt: {
        id: String,
        sentAt: Date,
    }
}, { timestamps: true }).index({ owner: 1, listingPid: 1, from: 1, to: 1 }, { unique: true })

module.exports = mongoose.model('Alert', alertSchema)
