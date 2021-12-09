// express server
const fs = require('fs');
const express = require("express");
const app = express();
app.use(express.static("public"));

options = {
    key: fs.readFileSync('certs/server.key'),
    cert: fs.readFileSync('certs/server.crt')
};

var port;
var io;
var options;



let clients = {};

async function main() {
    await setupHttpsServer();
    setupSocketServer();
}
main();

async function setupHttpsServer() {
    // var http = require('http');
    // var portHttp = process.env.PORTHTTP || 80;

    // var serverHttp = http.createServer(app).listen(portHttp, () => {
    //     console.log("listening on " + portHttp);
    // });

    var https = require('https');
    port = process.env.PORT || 8080;

    var serverHttps = https.createServer(options, app).listen(port, () => {
        console.log("listening on " + port);
    });

    io = require("socket.io")({
        cors: true
    }).listen(serverHttps);
}


function setupSocketServer() {
    console.log("setting up socket server");
    io.on("connection", (client) => {
        console.log("User " + client.id + " connected");

        clients[client.id] = {
            id: client.id
        };

        client.emit(
            "introduction",
            {
                id: client.id,
                clients: Object.keys(clients)
            }
        );

        io.sockets.emit(
            "newUserConnected",
            {
                id: client.id,
                clients: Object.keys(clients),
            }
        );

        client.on("disconnect", () => {
            delete clients[client.id];
            io.sockets.emit(
                "userDisconnected",
                {
                    id: client.id,
                    clients: Object.keys(clients)
                }
            );

            console.log(
                "User " + client.id + " disconnected"
            );
        });

        client.on("connect_failed", (err) => {
            console.log("connect failed!", err);
        });

        client.on("error", (err) => {
            console.log("there was an error on the connection!", err);
        });

        client.on("declare-identity", (data) => {
            if (data.identity != null) { };
            io.sockets.emit(
                "identity-declared",
                data
            );
        });

        client.on("mouseMove", (data) => {
            client.broadcast.emit(
                "onMouseMove",
                data
            );

            client.on("message", (data) => {
                const messageUser = {
                    id: data.id,
                    message: data.message,
                }
                const foundUser = findClientInRoom(data.id);
                if (foundUser != null) {
                    foundUser.message = data.message;
                }

                io.sockets.emit(
                    "messageSent",
                    {
                        ...messageUser,
                    }
                );
            });
        });
    }