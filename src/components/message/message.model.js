const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema({
    owner: { type: String, required: true },
    title: { type: String, required: true },
    text: { type: String, required: true },
}).index({ owner: 1, title: 1, text: 1 }, { unique: true })

module.exports = mongoose.model('Message', messageSchema)
