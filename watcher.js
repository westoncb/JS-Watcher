class Watcher {

    constructor() {
        this.nextId = 0;
    }

    watchify(object) {
        var proxy = this.getWatchifyProxy(object);

        var id = this.sendCreate('list');
        Reflect.set(proxy, 'watcher_id', id);

        return proxy;
    }

    getWatchifyProxy(object) {
        //Augment object with ds type-specific logic for handling property changes
        object.watcher_dslogic = this.newDSLogicForObject(object);

        var onChange = (obj, prop, oldVal, newVal) => {
            
            var operation = obj.watcher_dslogic.operationFromChangeData(obj, prop, oldVal, newVal);
            var message = "op|" + JSON.stringify(operation);

            this.sendMessageFunc(message);
        };

        var handler = {
            set (obj, prop, value) {
                const oldVal = obj[prop];
                Reflect.set(obj, prop, value);
                onChange(obj, prop, oldVal, value);

                return true;
            },
        }

        var proxy = new Proxy(object, handler);

        return proxy;
    }

    newDSLogicForObject(obj) {
        if (Array.isArray(obj)) {
            return new ListLogic(obj);
        } else {
            throw "We can only watch arrays right now!";
        }   
    }

    //Traverses the object tree and watchifies every sub object too
    watchifyRecursive(object) {

    }

    //Replaces object property with a watched version of the given property
    watch(object, property) {
        object[property] = this.watchify(object[property]);
    }

    watchScope(scopeString) {
        //parse scopeString
        //find variable declarations
    }

    sendCreate(dsType) {
        var operation = {
            dataStructureType: dsType,
            targetID: this.nextId++,
            type: 'create',
            location: [-1],
            timestamp: 0
        };

        var message = "op|" + JSON.stringify(operation);

        this.sendMessageFunc(message);

        return operation.targetID;
    }
}

class DSLogic {
    constructor(ds) {
        this.ds = ds;
        this.trackedFunctionCallStack = [];
    }

    trackedFunctionStarted(funcName, args) {
        this.trackedFunctionCallStack.push(funcName);
        console.log("starting: " + funcName + "; args: ", args, "; stack: ", this.trackedFunctionCallStack);
    }

    trackedFunctionEnded(funcName) {
        this.trackedFunctionCallStack.pop();
        console.log("finished: " + funcName + "; stack: ", this.trackedFunctionCallStack);
    }

    currentlyExecutingTrackedFunction() {
        return this.trackedFunctionCallStack[this.trackedFunctionCallStack.length - 1];
    }

    proxifyFunction(obj, funcName) {
        var self = this;

        obj[funcName] = new Proxy(obj[funcName], {apply: function(target, thisArg, argumentsList) {
                                        self.trackedFunctionStarted(funcName, argumentsList);
                                        Reflect.apply(target, thisArg, argumentsList)
                                        self.trackedFunctionEnded(funcName);
                                    }});
    }
}

//Needs 'logics' for these types:
// []
// Map
// custom treenode class
// other js object

class ListLogic extends DSLogic {

    constructor(obj) {
        super(obj);

        this.proxifyTrackedFunctions();
    }

    operationFromChangeData(obj, prop, oldVal, newVal) {
        var executingFunc = this.currentlyExecutingTrackedFunction();

        if (typeof executingFunc === 'string') {

            var handlerName = executingFunc + 'ChangeHandler';
            return this[handlerName](obj, prop, oldVal, newVal);

        } else { //Setting array value directly, e.g. a[3] = 5;
            console.log("direct array set; list[" + prop + "] = " + newVal + "; was " + oldVal);
        }
        

        return {coolStuff: "this is another test"};
    }

    pushChangeHandler(obj, prop, oldVal, newVal) {

        return {coolStuff: "this is another test"};
    }

    popChangeHandler(obj, prop, oldVal, newVal) {

        return {coolStuff: "this is another test"};
    }

    shiftChangeHandler(obj, prop, oldVal, newVal) {

        return {coolStuff: "this is another test"};
    }

    unshiftChangeHandler(obj, prop, oldVal, newVal) {

        return {coolStuff: "this is another test"};
    }

    spliceChangeHandler(obj, prop, oldVal, newVal) {
        console.log("in splice handler; this[" + prop + "] changed");

        return {coolStuff: "this is another test"};
    }

    proxifyTrackedFunctions() {
        var list = this.ds;

        this.proxifyFunction(list, 'push');
        this.proxifyFunction(list, 'pop');
        this.proxifyFunction(list, 'shift');
        this.proxifyFunction(list, 'splice');
        this.proxifyFunction(list, 'unshift');
    }
}

var w = new Watcher();

w.sendMessageFunc = function(message) {
    //send network message to Lucidity
};

var a = w.watchify([1, 2, 3, 4, 5, 6, 7, 8]);



a[8] = 1234;
a.push('xyz');
a.splice(2, 1);







//Access global scope anywhere:
// var global = Function('return this')();



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