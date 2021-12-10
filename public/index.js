const socketServer = config.socketServer || "https://localhost:8080";
let debug = false;
let socket
let this_client_id;
let el = {};
let clients = {};
let identity;
let ctx; //canvas context. 
let consoleElement;
let mouse = {
    x: 0,
    y: 0,
    normalized_x: 0,
    normalized_x: 0,
}
let painting = false;


window.onload = async () => {
    identity = document.querySelector("body").getAttribute("id");
    el.canvas = document.querySelector("#canvas");
    el.container = document.querySelector("#canvas_container");
    el.console = document.querySelector("#console");
    el.resetButton = document.querySelector("#reset_button");
    setupConsole();

    setupCanvas();
    resizeCanvas();
    initSocketConnection();
};

window.onresize = () => {
    resizeCanvas();
}


const resizeCanvas = () => {
    console.log("resizingcanvas");
    el.canvas.width = el.canvas.offsetWidth;
    el.canvas.height = el.canvas.offsetHeight;
};


const addToConsole = (_string) => {
    el.console.innerHTML += "<br>" + _string;
}

const setupConsole = () => {
    const urlSearchParams = new URLSearchParams(window.location.search);
    const params = Object.fromEntries(urlSearchParams.entries());
    if (params.debug) {
        debug = true;
    }
    if (debug && "console" in window) {
        methods = [
            "log", "assert", "clear", "count",
            "debug", "dir", "dirxml", "error",
            "exception", "group", "groupCollapsed",
            "groupEnd", "info", "profile", "profileEnd",
            "table", "time", "timeEnd", "timeStamp",
            "trace", "warn"
        ];

        generateNewMethod = function (oldCallback, methodName) {
            return function () {
                var args;
                addToConsole(methodName + ":" + arguments[0]);
                args = Array.prototype.slice.call(arguments, 0);
                Function.prototype.apply.call(oldCallback, console, arguments);
            };
        };

        for (i = 0, j = methods.length; i < j; i++) {
            cur = methods[i];
            if (cur in console) {
                old = console[cur];
                console[cur] = generateNewMethod(old, cur);
            }
        }

    }
}

function addIdentityToClients(user) {
    for (let i = 0; i < Object.keys(clients).length; i++) {
        if (Object.keys(clients)[i] == user.id) {
            clients[user.id].identity = user.identity;
        }
    };
}


function initSocketConnection() {
    console.log("attempting connection to " + socketServer);
    socket = io(socketServer, { secure: true });
    socket.on("connect", () => {
        console.log("socket.io connected to " + socketServer);
    });

    socket.on("connect_failed", (e) => {
        console.log("connect_failed");
    });

    socket.on("error", (e) => {
        console.log("error: " + e);
    });

    socket.on("introduction", (payload) => {
        this_client_id = payload.id;
        for (let i = 0; i < payload.clients.length; i++) {
            if (payload.clients[i] != this_client_id) {
                addClient(payload.clients[i]);

            }
        };

        socket.on("identity-declared", (payload) => {
            //check for 
        });

        socket.on("newUserConnected", (payload) => {
            let alreadyHasUser = false;

            for (let i = 0; i < Object.keys(clients).length; i++) {
                if (Object.keys(clients)[i] == payload.id) {
                    alreadyHasUser = true;
                    break;
                }
            }

            if (payload.id != this_client_id && !alreadyHasUser) {
                addClient(payload.id);
            } else {
                declareIdentity(identity);
            }

        });

        socket.on("userDisconnected", (payload) => {
            if (payload.id != this_client_id) {
                delete clients[payload.id];
            }
        });

        socket.on("onMessage", (payload) => {
            switch (payload.message) {
                case "mouseUp":
                    //ctx.closePath();
                    break;

            }
        });

        socket.on("onMouseMove", (payload) => {
            let screen_x = payload.x * el.canvas.width;
            let screen_y = payload.y * el.canvas.height;
            onPaint(screen_x, screen_y);
        });
    });
}


function setupCanvas() {
    ctx = el.canvas.getContext('2d');
    ctx.lineWidth = 20;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';


    window.requestAnimFrame = (function (callback) {
        return window.requestAnimationFrame ||
            window.webkitRequestAnimationFrame ||
            window.mozRequestAnimationFrame ||
            window.oRequestAnimationFrame ||
            window.msRequestAnimaitonFrame ||
            function (callback) {
                window.setTimeout(callback, 1000 / 60);
            };
    })();

    el.canvas.addEventListener('mousedown', (e) => {
        console.log("mouse down: " + e.pageX);
        ctx.closePath();
        mouse = getMousePosition(e);
        ctx.moveTo(mouse.x, mouse.y);
        ctx.beginPath();
        painting = true;
    }, false);


    el.canvas.addEventListener('mouseup', () => {
        ctx.closePath;
        painting = false;
        socket.emit("message", {
            message: "mouseUp",
            x: mouse.normalized_x,
            y: mouse.normalized_y,
            id: this_client_id,
        });
    }, false);

    el.canvas.addEventListener('mousemove', (e) => {
        if (painting) {
            onMousePaint(e);
        }
    });

    el.canvas.addEventListener("touchstart", (e) => {
        let touch = e.touches[0];
        ctx.closePath();
        mouse = getMousePosition(touch);
        ctx.moveTo(mouse.x, mouse.y);
        ctx.beginPath();
        painting = true;
    }, false);

    el.canvas.addEventListener("touchend", (e) => {
        let touch = e.touches[0];
        ctx.closePath;
        painting = false;
        socket.emit("message", {
            message: "mouseUp",
            x: mouse.normalized_x,
            y: mouse.normalized_y,
            id: this_client_id,
        });
    }, false);

    el.canvas.addEventListener("touchmove", (e) => {
        let touch = e.touches[0];
        if (painting) {
            onMousePaint(touch);
        }
        el.canvas.dispatchEvent(mouseEvent);
    }, false);

    document.body.addEventListener("touchstart", function (e) {
        if (e.target == el.canvas) {
            e.preventDefault();
        }
    }, false);
    document.body.addEventListener("touchend", function (e) {
        if (e.target == el.canvas) {
            e.preventDefault();
        }
    }, false);
    document.body.addEventListener("touchmove", function (e) {
        if (e.target == el.canvas) {
            e.preventDefault();
        }
    }, false);


    const onMousePaint = (e) => {
        mouse = getMousePosition(e);
        socket.emit("mouseMove", {
            identity,
            x: mouse.normalized_x,
            y: mouse.normalized_y,
            id: this_client_id
        });
        onPaint(mouse.x, mouse.y);
    };

    el.resetButton.addEventListener("click", (e) => {
        e.preventDefault();
        socket.emit("message", {
            identity,
            message: "clear",
            id: this_client_id
        });
        clearCanvas();
    });
}

function getMousePosition(e) {
    mouse.x = e.pageX - el.canvas.offsetLeft;
    mouse.y = e.pageY - el.canvas.offsetTop;
    mouse.normalized_x = mouse.x / el.canvas.width;
    mouse.normalized_y = mouse.y / el.canvas.height;
    return mouse;
}

function getTouchPosition(e) {
    mouse.x = e.touches[0].pageX - el.canvas.offsetLeft;
    mouse.y = e.touches[0].pageY - el.canvas.offsetTop;
    mouse.normalized_x = mouse.x / el.canvas.width;
    mouse.normalized_y = mouse.y / el.canvas.height;
    return mouse;
}


function clearCanvas() {
    ctx.closePath;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
}


function onPaint(x, y) {
    ctx.lineTo(x, y);
    ctx.stroke();
}

function addClient(_id) {
    console.log("adding client with _id " + _id);
    clients[_id] = {};
    clients[_id].id = _id;
}

