const mongoose = require('mongoose')

const contactSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
    sessionId: String,
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    relationship: { type: String, required: true },
    optedIn: Boolean,
    code: String
})

module.exports = mongoose.model('Contact', contactSchema)
