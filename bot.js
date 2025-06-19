const { Client, LocalAuth } = require('whatsapp-web.js');
const pidusage = require('pidusage');
const qrcode = require('qrcode-terminal');

const GRUPOS_ADMS = {
    '120363041879040971@g.us': [ // primeiro distrito
        '556992484535@c.us', // elvis 
        '556993957157@c.us', // rafael 
        '556993299906@c.us', // fabio  
    ],
    '120363041941704716@g.us': [ // segundo distrito
        '556999648335@c.us', // luan 
        '556993957157@c.us', // rafael 
        '556993299906@c.us', // fabio   
    ]
};

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run'
        ]
    }
});

const MapTimeouts = new Map(); // grupoId => array de contextos de figurinha pendentes
const processingIds = new Set(); // evita race condition
let lastQrCode = null;

function getLastQrCode() {
    return lastQrCode;
}

function initializeBot() {
    client.on('qr', (qr) => {
        lastQrCode = qr;
        qrcode.generate(qr, { small: true });
        console.log('QR Code gerado! Escaneie com seu WhatsApp.');
    });

    client.on('ready', () => {
        console.log('Bot do JipaExpress conectado!');
        console.log(`Monitorando os grupos: ${Object.keys(GRUPOS_ADMS).join(', ')}`);
    });

    client.on('message', async (msg) => {
        try {
            const { from, type, id } = msg;
            console.log(`[RECEBIDO] Mensagem recebida de: ${from}, tipo: ${type}, id: ${id && id._serialized}`);

            if (!Object.keys(GRUPOS_ADMS).includes(from)) {
                console.log(`[IGNORADO] Mensagem de grupo não monitorado: ${from}`);
                return;
            }

            // === Figurinha recebida ===
            if (type === 'sticker' && from.endsWith('@g.us')) {
                const grupoId = from;
                console.log(`[STICKER] Figurinha recebida do grupo: ${grupoId}`);

                const media = await msg.downloadMedia();
                if (!media) {
                    console.warn(`[ERRO] Não foi possível baixar a figurinha no grupo ${grupoId}`);
                    return;
                }

                const ctx = {
                    id: Date.now() + Math.random(),
                    respondido: false,
                    createdAt: Date.now(),
                    quotedMsgId: msg.id._serialized,
                    respostasPendentes: []
                };

                const listaAtual = MapTimeouts.get(grupoId) || [];
                listaAtual.push(ctx);
                MapTimeouts.set(grupoId, listaAtual);
                console.log(`[PENDENTE] Contexto de figurinha adicionado para o grupo ${grupoId}. Total pendentes: ${listaAtual.length}`);
                return;
            }

            // === Resposta do motoboy ===
            if (type === 'chat' && from.endsWith('@g.us')) {
                const grupoId = from;
                const lista = MapTimeouts.get(grupoId) || [];
                console.log(`[CHAT] Mensagem de texto recebida no grupo ${grupoId}. Pendências: ${lista.length}`);

                let pendente = null;

                if (msg.hasQuotedMsg) {
                    const quoted = await msg.getQuotedMessage();
                    console.log(`[CITACAO] Mensagem cita: ${quoted.id._serialized}`);

                    for (const ctx of lista) {
                        if (!ctx.respondido && quoted.id._serialized === ctx.quotedMsgId) {
                            pendente = ctx;
                            break;
                        }
                    }
                }

                if (!pendente) {
                    console.log(`[SEM PENDENTE] Nenhum contexto pendente encontrado para a citação.`);
                    return;
                }

                if (!pendente.respostasPendentes.find(r => r.id === id._serialized)) {
                    pendente.respostasPendentes.push({
                        id: id._serialized,
                        respondido: false,
                        msgObj: msg
                    });
                    console.log(`[RESPOSTA NOVA] Resposta adicionada ao contexto ${pendente.id}. Total respostas: ${pendente.respostasPendentes.length}`);
                }

                if (pendente.respondido || processingIds.has(pendente.id)) {
                    console.log(`[IGNORADO] Contexto já respondido ou em processamento: ${pendente.id}`);
                    return;
                }

                processingIds.add(pendente.id);
                console.log(`[PROCESSANDO] Iniciando processamento do contexto ${pendente.id}`);

                (async () => {
                    try {
                        if (pendente.respondido) return;

                        const listaRespostas = pendente.respostasPendentes
                            .filter(r => !r.respondido && r.msgObj)
                            .sort((a, b) => {
                                if (a.msgObj.timestamp && b.msgObj.timestamp) {
                                    return a.msgObj.timestamp - b.msgObj.timestamp;
                                } else if (a.msgObj.timestamp) {
                                    return -1;
                                } else if (b.msgObj.timestamp) {
                                    return 1;
                                } else {
                                    return 0;
                                }
                            });
                        console.log(`[PROCESSANDO] Respostas pendentes ordenadas: ${listaRespostas.map(r => r.id).join(', ')}`);

                        for (const resposta of listaRespostas) {
                            if (pendente.respondido) break;

                            const motoboyNumero = resposta.msgObj.author || resposta.msgObj.from;
                            const agora = Date.now();

                            // Substitui fetchMessages por getQuotedMessage
                            try {
                                const quoted = await resposta.msgObj.getQuotedMessage();
                                if (quoted && quoted.id._serialized === pendente.quotedMsgId) {
                                    // mensagem ainda existe
                                    await client.sendMessage(grupoId, '🆗', {
                                        quotedMessageId: resposta.id
                                    });
                                    resposta.respondido = true;
                                    pendente.respondido = true;

                                    const listaAtualizada = (MapTimeouts.get(grupoId) || []).filter(item => item.id !== pendente.id);
                                    MapTimeouts.set(grupoId, listaAtualizada);
                                    break;
                                } else {
                                    console.log(`[APAGADA] Mensagem ${resposta.id} foi apagada ou não encontrada.`);
                                }
                            } catch (e) {
                                console.log(`[APAGADA] Mensagem ${resposta.id} foi apagada ou não encontrada.`);
                                continue;
                            }
                        }

                        processingIds.delete(pendente.id);
                        console.log(`[FIM] Processamento finalizado para contexto ${pendente.id}`);

                        // Após o processamento das respostas, logar os números dos motoboys que responderam na ordem de chegada
                        const motoboysRespondentes = pendente.respostasPendentes
                            .filter(r => r.msgObj)
                            .sort((a, b) => {
                                if (a.msgObj.timestamp && b.msgObj.timestamp) {
                                    return a.msgObj.timestamp - b.msgObj.timestamp;
                                } else if (a.msgObj.timestamp) {
                                    return -1;
                                } else if (b.msgObj.timestamp) {
                                    return 1;
                                } else {
                                    return 0;
                                }
                            })
                            .map(r => r.msgObj.author || r.msgObj.from);
                        if (motoboysRespondentes.length > 0) {
                            console.log(`[MOTOBOYS] Números dos motoboys que responderam (ordem de chegada): ${motoboysRespondentes.join(', ')}`);
                        }
                    } catch (error) {
                        console.error('[ERRO] Erro ao processar respostas:', error);
                        processingIds.delete(pendente.id);
                    }
                })();
            }
        } catch (err) {
            console.error('[ERRO] Erro no on message:', err);
        }
    });

    client.initialize();
}

// Ajuste: limpeza periódica de MapTimeouts e respostasPendentes antigas para 15 minutos
setInterval(() => {
    // Limpa contextos antigos (mais de 15 min)
    const agora = Date.now();
    for (const [grupoId, lista] of MapTimeouts.entries()) {
        const novaLista = lista.filter(ctx => agora - ctx.createdAt < 15 * 60 * 1000);
        MapTimeouts.set(grupoId, novaLista);
    }
    // Limpa respostasPendentes antigas (mais de 15 min)
    for (const [grupoId, lista] of MapTimeouts.entries()) {
        for (const ctx of lista) {
            ctx.respostasPendentes = ctx.respostasPendentes.filter(r => {
                if (!r.msgObj || !r.msgObj.timestamp) return true;
                return agora - (r.msgObj.timestamp * 1000) < 15 * 60 * 1000;
            });
        }
    }
    // Limpa processingIds de contextos que não existem mais
    const idsAtivos = new Set();
    for (const lista of MapTimeouts.values()) {
        for (const ctx of lista) {
            idsAtivos.add(ctx.id);
        }
    }
    for (const id of Array.from(processingIds)) {
        if (!idsAtivos.has(id)) processingIds.delete(id);
    }
    // Logar tamanho dos mapas
    console.log(`[LIMPEZA] MapTimeouts: ${Array.from(MapTimeouts.values()).reduce((acc, l) => acc + l.length, 0)} contextos, processingIds: ${processingIds.size}`);
}, 30 * 60 * 1000); // a cada 30 minutos

setInterval(() => {
    pidusage(process.pid).then(stats => {
        const mem = (stats.memory / 1024 / 1024).toFixed(2);
        const cpu = stats.cpu.toFixed(2);
        console.log(`[📊 USO] Memória: ${mem} MB | CPU: ${cpu}%`);
    }).catch(err => {
        console.error('Erro ao obter uso de processo:', err);
    });
}, 60000);

module.exports = { initializeBot, getLastQrCode };
