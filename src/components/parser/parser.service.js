const cheerio = require('cheerio')

const namespace = 'jc-backend:parser:service'
const parseMetadata = async (html) => {
    const $ = cheerio.load(html)
    const title = $('title').text()
    const metadata = {
        title
    }
    return metadata
}

module.exports = {
    parseMetadata
}