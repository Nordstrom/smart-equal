import getType from 'should-type';
import format from './format';

var hasOwnProperty = Object.prototype.hasOwnProperty;

function EqualityFail(a, b, reason, path) {
  this.a = a;
  this.b = b;
  this.reason = reason;
  this.path = path;
}

function typeToString(t) {
  return t.type + (t.cls ? '(' + t.cls + (t.sub ? ' ' + t.sub : '') + ')' : '');
}

var  PLUS_0_AND_MINUS_0 = '+0 is not equal to -0';
var  DIFFERENT_TYPES = 'A has type %s and B has type %s';
var  EQUALITY = 'A is not equal to B';
var  EQUALITY_PROTOTYPE = 'A and B have different prototypes';
var  WRAPPED_VALUE = 'A wrapped value is not equal to B wrapped value';
var  FUNCTION_SOURCES = 'function A is not equal to B by source code value (via .toString call)';
var  MISSING_KEY = '%s has no key %s';
var  SET_MAP_MISSING_KEY = 'Set/Map missing key %s';


var DEFAULT_OPTIONS = {
  checkProtoEql: true,
  checkSubType: true,
  plusZeroAndMinusZeroEqual: true,
  collectAllFails: false
};

function setBooleanDefault(property, obj, opts, defaults) {
  obj[property] = typeof opts[property] !== 'boolean' ? defaults[property] : opts[property];
}

var METHOD_PREFIX = '_check_';

function EQ(opts, a, b, path) {
  opts = opts || {};

  setBooleanDefault('checkProtoEql', this, opts, DEFAULT_OPTIONS);
  setBooleanDefault('plusZeroAndMinusZeroEqual', this, opts, DEFAULT_OPTIONS);
  setBooleanDefault('checkSubType', this, opts, DEFAULT_OPTIONS);
  setBooleanDefault('collectAllFails', this, opts, DEFAULT_OPTIONS);

  this.a = a;
  this.b = b;

  this._meet = opts._meet || [];

  this.fails = opts.fails || [];

  this.path = path || [];
}

function ShortcutError(fail) {
  this.name = 'ShortcutError';
  this.message = 'fail fast';
  this.fail = fail;
}

ShortcutError.prototype = Object.create(Error.prototype);

EQ.checkStrictEquality = function(a, b) {
  this.collectFail(a !== b, EQUALITY);
};

EQ.add = function add(type, cls, sub, f) {
  var args = Array.prototype.slice.call(arguments);
  f = args.pop();
  EQ.prototype[METHOD_PREFIX + args.join('_')] = f;
};

EQ.prototype = {
  check: function() {
    try {
      this.check0();
    } catch (e) {
      if (e instanceof ShortcutError) {
        return [e.fail];
      }
      throw e;
    }
    return this.fails;
  },

  check0: function() {
    var a = this.a;
    var b = this.b;

    // equal a and b exit early
    if (a === b) {
      // check for +0 !== -0;
      return this.collectFail(a === 0 && (1 / a !== 1 / b) && !this.plusZeroAndMinusZeroEqual, PLUS_0_AND_MINUS_0);
    }

    var typeA = getType(a);
    var typeB = getType(b);

    // if objects has different types they are not equal
    var typeDifferent = typeA.type !== typeB.type || typeA.cls !== typeB.cls;

    if (typeDifferent || ((this.checkSubType && typeA.sub !== typeB.sub) || !this.checkSubType)) {
      return this.collectFail(true, format(DIFFERENT_TYPES, typeToString(typeA), typeToString(typeB)));
    }

    // as types the same checks type specific things
    var name1 = typeA.type, name2 = typeA.type;
    if (typeA.cls) {
      name1 += '_' + typeA.cls;
      name2 += '_' + typeA.cls;
    }
    if (typeA.sub) {
      name2 += '_' + typeA.sub;
    }

    var f = this[METHOD_PREFIX + name2] || this[METHOD_PREFIX + name1] || this[METHOD_PREFIX + typeA.type] || this.defaultCheck;

    f.call(this, this.a, this.b);
  },

  collectFail: function(comparison, reason, showReason) {
    if (comparison) {
      var res = new EqualityFail(this.a, this.b, reason, this.path);
      res.showReason = !!showReason;

      this.fails.push(res);

      if (!this.collectAllFails) {
        throw new ShortcutError(res);
      }
    }
  },

  checkPlainObjectsEquality: function(a, b) {
    // compare deep objects and arrays
    // stacks contain references only
    //
    var meet = this._meet;
    var m = this._meet.length;
    while (m--) {
      var st = meet[m];
      if (st[0] === a && st[1] === b) {
        return;
      }
    }

    // add `a` and `b` to the stack of traversed objects
    meet.push([a, b]);

    // TODO maybe something else like getOwnPropertyNames
    var key;
    for (key in b) {
      if (hasOwnProperty.call(b, key)) {
        if (hasOwnProperty.call(a, key)) {
          this.checkPropertyEquality(key);
        } else {
          this.collectFail(true, format(MISSING_KEY, 'A', key));
        }
      }
    }

    // ensure both objects have the same number of properties
    for (key in a) {
      if (hasOwnProperty.call(a, key)) {
        this.collectFail(!hasOwnProperty.call(b, key), format(MISSING_KEY, 'B', key));
      }
    }

    meet.pop();

    if (this.checkProtoEql) {
      //TODO should i check prototypes for === or use eq?
      this.collectFail(Object.getPrototypeOf(a) !== Object.getPrototypeOf(b), EQUALITY_PROTOTYPE, true);
    }

  },

  checkPropertyEquality: function(propertyName) {
    var eq = new EQ(this, this.a[propertyName], this.b[propertyName], this.path.concat([propertyName]));
    eq.check0();
  },

  defaultCheck: EQ.checkStrictEquality
};


EQ.add('number', function(a, b) {
  this.collectFail((a !== a && b === b) || (b !== b && a === a) || (a !== b && a === a && b === b), EQUALITY);
});

['symbol', 'boolean', 'string'].forEach(function(tp) {
  EQ.add(tp, EQ.checkStrictEquality);
});

EQ.add('function', function(a, b) {
  // functions are compared by their source code
  this.collectFail(a.toString() !== b.toString(), FUNCTION_SOURCES);
  // check user properties
  this.checkPlainObjectsEquality(a, b);
});

EQ.add('object', 'regexp', function(a, b) {
  // check regexp flags
  var flags = ['source', 'global', 'multiline', 'lastIndex', 'ignoreCase', 'sticky', 'unicode'];
  while (flags.length) {
    this.checkPropertyEquality(flags.shift());
  }
  // check user properties
  this.checkPlainObjectsEquality(a, b);
});

EQ.add('object', 'date', function(a, b) {
  //check by timestamp only (using .valueOf)
  this.collectFail(+a !== +b, EQUALITY);
  // check user properties
  this.checkPlainObjectsEquality(a, b);
});

['number', 'boolean', 'string'].forEach(function(tp) {
  EQ.add('object', tp, function(a, b) {
    //primitive type wrappers
    this.collectFail(a.valueOf() !== b.valueOf(), WRAPPED_VALUE);
    // check user properties
    this.checkPlainObjectsEquality(a, b);
  });
});

EQ.add('object', function(a, b) {
  this.checkPlainObjectsEquality(a, b);
});

['array', 'arguments', 'typed-array'].forEach(function(tp) {
  EQ.add('object', tp, function(a, b) {
    this.checkPropertyEquality('length');

    this.checkPlainObjectsEquality(a, b);
  });
});

EQ.add('object', 'array-buffer', function(a, b) {
  this.checkPropertyEquality('byteLength');

  this.checkPlainObjectsEquality(a, b);
});

EQ.add('object', 'error', function(a, b) {
  this.checkPropertyEquality('name');
  this.checkPropertyEquality('message');

  this.checkPlainObjectsEquality(a, b);
});

EQ.add('object', 'buffer', function(a) {
  this.checkPropertyEquality('length');

  var l = a.length;
  while (l--) {
    this.checkPropertyEquality(l);
  }

  //we do not check for user properties because
  //node Buffer have some strange hidden properties
});

['map', 'set'].forEach(function(tp) {
  EQ.add('object', tp, function(a, b) {
    this._meet.push([a, b]);

    var iteratorA = a.entries();
    for (var nextA = iteratorA.next(); !nextA.done; nextA = iteratorA.next()) {

      var iteratorB = b.entries();
      var keyFound = false;
      for (var nextB = iteratorB.next(); !nextB.done; nextB = iteratorB.next()) {
        // try to check keys first
        var r = eq(nextA.value[0], nextB.value[0], { collectAllFails: false, _meet: this._meet });

        if (r.length === 0) {
          keyFound = true;

          // check values also
          eq(nextA.value[1], nextB.value[1], this);
        }
      }

      if (!keyFound) {
        // no such key at all
        this.collectFail(true, format(SET_MAP_MISSING_KEY, nextA.value[0]));
      }
    }

    this._meet.pop();

    this.checkPlainObjectsEquality(a, b);
  });
});


export default function eq(a, b, opts) {
  return new EQ(opts, a, b).check();
}

eq.EQ = EQ;
