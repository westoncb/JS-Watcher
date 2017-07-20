// var global = Function('return this')();

class Watcher {

    constructor() {
        Watcher.idMap = new Map();
        Watcher.nextId = 0;
    }

    static setSendMessageFunc(func) {
        Watcher.sendMessageFunc = func;
    }

    static watchify(object) {
        var proxy = Watcher.getWatchifyProxy(object);

        proxy.watcher_id = Watcher.sendCreateOp('list');

        return proxy;
    }

    static getWatchifyProxy(object) {
        var onChange = function (obj, prop, oldVal, newVal) {
            
            var operation = Watcher.operationFromChangeData(obj, prop, oldVal, newVal);
            var message = "op|" + JSON.stringify(operation);

            Watcher.sendMessageFunc(message);
        };

        var handler = {
            set (obj, prop, value) {
                const oldVal = obj[prop];
                Reflect.set(obj, prop, value);
                onChange(obj, prop, oldVal, value);
            },
        }

        var proxy = new Proxy(object, handler);

        return proxy;
    }

    //Traverses the object tree and watchifies every sub object too
    static watchifyRecursive(object) {

    }

    //Replaces object property with a watched version of the given property
    static watch(object, property) {
        object[property] = Watcher.watchify(object[property]);
    }

    static watchScope(scopeString) {
        //parse scopeString
        //find variable declarations
    }

    static sendCreateOp(dsType) {
        var operation = {
            dataStructureType: dsType,
            targetID: Watcher.nextId++,
            type: 'create',
            location: [-1],
            timestamp: 0
        };

        var message = "op|" + JSON.stringify(operation);

        Watcher.sendMessageFunc(message);

        return operation.targetID;
    }

    static operationFromChangeData(obj, prop, oldVal, newVal) {
        // []
        // Map
        // custom treenode class
        // other js object

        if (Array.isArray(obj)) {

        } else {
            throw "We can only watch arrays right now!";
        }

        return {coolStuff: "this is another test"};
    }
}

var cool = function () {
    var a = 234;
    var b = 42;
    var c = 921;   

    return this;
};

Watcher.setSendMessageFunc(function(message) {
    console.log("the message: ", message);
});

var a = Watcher.watchify([1, 2, 3]);

a[0] = 1234;






















// var global = {};

// Object.defineProperty(global, '__stack', {
//   get: function(){
//     var orig = Error.prepareStackTrace;
//     Error.prepareStackTrace = function(_, stack){ return stack; };
//     var err = new Error;
//     Error.captureStackTrace(err, arguments.callee);
//     var stack = err.stack;
//     Error.prepareStackTrace = orig;
//     return stack;
//   }
// });

// Object.defineProperty(global, '__line', {
//   get: function(){
//     return global.__stack[1].getLineNumber();
//   }
// });

// console.log(global.__line);