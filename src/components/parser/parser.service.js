const cheerio = require('cheerio')

const namespace = 'jc-backend:parser:service'
const parseMetadata = async (html) => {
    const $ = cheerio.load(html)
    const timeElement = $('.postinginfo.reveal')
    const datetime = timeElement.attr('datetime')
    const friendlyDatetimes = $('p.postinginfo.reveal').toArray().reduce((accumulator, element) => {
        const name = $(element).text().split(':')[0].trim()
        const time = $(element).find('time.date.timeago').text()
        accumulator[name] = time
        return accumulator
    }, {})

    const title = $('title').text()
    const ogTitle = $('meta[property="og:title"]').attr('content')
    const ogDescription = $('meta[property="og:description"]').attr('content')
    const ogImage = $('meta[property="og:image"]').attr('content')
    const geoPosition = $('meta[name="geo.position"]').attr('content')
    const geoPlace = $('meta[name="geo.placename"]').attr('content')
    const geoRegion = $('meta[name="geo.region"]').attr('content')
    const metadata = {
        datetime,
        friendlyDatetimes,
        title,
        ogTitle,
        ogDescription,
        ogImage,
        geoPosition,
        geoPlace,
        geoRegion
    }
    return metadata
}

module.exports = {
    parseMetadata
}