require('dotenv').config();
const localtunnel = process.env.NODE_ENV !== 'production' ? require('localtunnel') : undefined;
const ngrok = process.env.NODE_ENV !== 'production' ? require('ngrok') : undefined;
const dnsTunnel = process.env.NODE_ENV !== 'production' ? require('@667/ngrok-dns') : undefined;

const {
    NODE_ENV,
    DOMAIN,
    NGROK_AUTH_TOKEN
} = process.env

if (NODE_ENV !== 'production')
    (async function () {
        try {
            /*
            const tunnel = await localtunnel({
                port: 3000,
                allow_invalid_cert: true,
                local_https: true,
                debug: true,
            });
            dnsTunnel(tunnel.url);
            console.log(`dnsTunnel: ${tunnel.url}`);
            */
            const tunnel = await ngrok.connect({
                addr: `https://${DOMAIN}`,
                onLogEvent: dnsTunnel,
                authtoken: NGROK_AUTH_TOKEN
            });
            dnsTunnel(tunnel);
            console.log(`dnsTunnel: ${tunnel}`);
        } catch (error) {
            console.error(error);
        }
    })();