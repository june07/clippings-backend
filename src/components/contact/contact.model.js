const mongoose = require('mongoose')

const contactSchema = new mongoose.Schema({
    owner: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    relationship: { type: String, required: true },
})

module.exports = mongoose.model('Contact', contactSchema)
