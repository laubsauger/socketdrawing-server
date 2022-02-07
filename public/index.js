const socketServer = config.socketServer || 'https://localhost:8080';
let debug = false;
let socket;
let this_client_id;
let this_client_index = 0;
let el = {};
let clients = {};
let isActiveSession = false;
let identity;
let ctx;
let consoleElement;
let mouse = {
    x: 0,
    y: 0,
    normalized_x: 0,
    normalized_y: 0,
}
let painting = false;

window.onload = async () => {
    identity = document.querySelector('body').getAttribute('id');
    el.canvas = document.querySelector('#canvas');
    el.container = document.querySelector('#canvas_container');
    el.console = document.querySelector('#console');
    el.info = document.querySelector('#info');
    el.status = document.querySelector('#status');
    el.controls = document.querySelector('#controls');
    el.btns = document.getElementsByClassName('btn');

    setupConsole();
    setupCanvas();
    resizeCanvas();

    initSocketConnection();
};

window.onresize = () => {
    resizeCanvas();
}

const resizeCanvas = () => {
    console.log('resizingcanvas');
    el.canvas.width = el.canvas.offsetWidth;
    el.canvas.height = el.canvas.offsetHeight;
};

const updateClientInfo = (id, index, numUsers, maxNumUsers) => {
    el.info.innerHTML = `Slot: ${index} | Users: ${numUsers}/${maxNumUsers} | ${id}`
}

const addToConsole = (_string) => {
    el.console.innerHTML += '<br>' + _string;
}

const updateStatus = (msg) => {
    el.status.innerHTML += '<br>' + msg;
}

const showControls = () => {
    el.controls.style.display = 'block';
    resizeCanvas();
}

const hideStatus = () => {
    el.status.style.display = 'none';
}

const setupConsole = () => {
    const urlSearchParams = new URLSearchParams(window.location.search);
    const params = Object.fromEntries(urlSearchParams.entries());
    if (params.debug) {
        debug = true;
    }
    if (debug && 'console' in window) {
        methods = [
            'log', 'assert', 'clear', 'count',
            'debug', 'dir', 'dirxml', 'error',
            'exception', 'group', 'groupCollapsed',
            'groupEnd', 'info', 'profile', 'profileEnd',
            'table', 'time', 'timeEnd', 'timeStamp',
            'trace', 'warn'
        ];

        generateNewMethod = function (oldCallback, methodName) {
            return function () {
                var args;
                addToConsole(methodName + ':' + arguments[0]);
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
        if (Object.keys(clients)[i] === user.id) {
            clients[user.id].identity = user.identity;
        }
    }
}


const activeButtons = [];

function initSocketConnection() {
    console.log('attempting socket connection');
    updateStatus(`> Attempting to connect to ${socketServer}`);

    // handle requesting specific slot and pass as query
    const urlSearchParams = new URLSearchParams(window.location.search);
    const params = Object.fromEntries(urlSearchParams.entries());
    let query = '';
    if (params.slot) {
        query = `wantsSlot=${params.slot}`;
    }

    socket = io(socketServer, { secure: true, query });

    socket.on('connect', () => {
        updateStatus(`> connected`);
        console.log('socket.io connected to ' + socketServer);
    });

    socket.on('disconnect', () => {
        updateStatus('> server rejected connection (session may be full)');
        updateStatus('> wait a bit and reload page to try again');
        isActiveSession = false;
        console.log('socket.io disconnected');
    });

    socket.on('connect_failed', (e) => {
        updateStatus(`> connect failed`);
        console.log('connect_failed');
    });

    socket.on('error', (e) => {
        updateStatus(`> socket error`);
        console.log('error: ' + e);
    });

    socket.on('introduction', (payload) => {
        hideStatus();
        showControls();

        isActiveSession = true;
        console.log('introduced as client_index', payload.client_index, payload.maxClients);

        this_client_id = payload.id;
        this_client_index = payload.client_index;

        updateClientInfo(this_client_id, this_client_index, payload.usedSlots, payload.maxClients);
    });

    socket.on('newUserConnected', (payload) => {
        console.log('newUserConnected', payload);

        updateClientInfo(this_client_id, this_client_index, payload.usedSlots, payload.maxClients);
    });

    socket.on('userDisconnected', (payload) => {
        console.log('userDisconnected', payload);

        updateClientInfo(this_client_id, this_client_index, payload.usedSlots, payload.maxClients);
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
        painting = true;
        emitMouseDownState(1);
        emitPaintMessage(e);
    }, false);


    el.canvas.addEventListener('mouseup', () => {
        ctx.closePath;
        painting = false;
    }, false);

    el.canvas.addEventListener('mousemove', (e) => {
        if (painting) {
            emitPaintMessage(e);
        }
    });

    el.canvas.addEventListener('touchstart', (e) => {
        let touch = e.touches[0];
        mouse = getMousePosition(touch);
        painting = true;
    }, false);

    el.canvas.addEventListener('touchend', (e) => {
        let touch = e.touches[0];
        painting = false;
        emitMouseDownState(0);
    }, false);

    el.canvas.addEventListener('touchmove', (e) => {
        let touch = e.touches[0];
        if (painting) {
            emitPaintMessage(touch);
        }
        // el.canvas.dispatchEvent(mouseEvent);
    }, false);

    document.body.addEventListener('touchstart', function (e) {
        emitMouseDownState(1);

        if (e.target === el.canvas) {
            // e.preventDefault();
            emitPaintMessage(e);
        }
    }, false);
    document.body.addEventListener('touchend', function (e) {
        emitMouseDownState(0);

        if (e.target === el.canvas) {
            // e.preventDefault();
        }
    }, false);
    document.body.addEventListener('touchmove', function (e) {
        if (e.target === el.canvas) {
            // e.preventDefault();
        }
    }, false);

    function emitMouseDownState(state) {
        if (state === 0) {
            resetButtons();
        }

        console.log('mouseDown', state);
        socket.emit('message', {
            message: 'mouseDown',
            identity,
            state: state,
            id: this_client_id,
        });
    }

    document.body.addEventListener('mouseup', (e) => {
        emitMouseDownState(0);
    }, false);

    const updateCanvasCrossHair = (mousePos) => {
        onPaint(mousePos.x, mousePos.y);
    }

    const emitPaintMessage = (event) => {
        const mousePos = getMousePosition(event);
        socket.emit('message', {
            message: 'paint',
            identity,
            x: mousePos.normalized_x,
            y: mousePos.normalized_y,
            id: this_client_id
        });
        updateCanvasCrossHair(mousePos);
    };

    const buttonPressListener = (e) => {
        console.log('btn down: ' + e.target.id);

        activeButtons[e.target.id] = true;

        e.preventDefault();
        socket.emit(`message`, {
            message: 'button',
            identity,
            btnId: e.target.id,
            state: 1,
            id: this_client_id,
        });
    }

    const buttonReleaseListener = (e) => {
        console.log('btn up: ' + e.target.id);

        activeButtons[e.target.id] = false;

        e.preventDefault();
        socket.emit(`message`, {
            message: 'button',
            identity,
            btnId: e.target.id,
            state: 0,
            id: this_client_id,
        });
    }

    const resetButtons = () => {
        for (let i = 0; i < el.btns.length; i++) {
            if (activeButtons[el.btns[i].id]) {
                el.btns[i].dispatchEvent(new MouseEvent('mouseup'));
                activeButtons[el.btns[i].id] = false;
            }
        }
    }

    for (var i = 0; i < el.btns.length; i++) {
        el.btns[i].addEventListener('mousedown', buttonPressListener);
        el.btns[i].addEventListener('touchstart', buttonPressListener);

        el.btns[i].addEventListener('mouseup', buttonReleaseListener);
        el.btns[i].addEventListener('touchEnd', buttonReleaseListener);

        // el.btns[i].addEventListener('click', (e) => {
        //     e.preventDefault();
        //     console.log('clicking btn: ' + e.target.id);
        //     socket.emit('message', {
        //         message: e.target.id,
        //         id: this_client_id,
        //     });
        // });
    }
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.closePath();
    // ctx.lineTo(x, y);
    // ctx.stroke();
}

function addClient(_id) {
    console.log('adding client with _id ' + _id);
    clients[_id] = {};
    clients[_id].id = _id;
}

