(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding) {
  var self = this
  if (!(self instanceof Buffer)) return new Buffer(subject, encoding)

  var type = typeof subject
  var length

  if (type === 'number') {
    length = +subject
  } else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) {
    // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data)) subject = subject.data
    length = +subject.length
  } else {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (length > kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum size: 0x' +
      kMaxLength.toString(16) + ' bytes')
  }

  if (length < 0) length = 0
  else length >>>= 0 // coerce to uint32

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    self = Buffer._augment(new Uint8Array(length)) // eslint-disable-line consistent-this
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    self.length = length
    self._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    self._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++) {
        self[i] = subject.readUInt8(i)
      }
    } else {
      for (i = 0; i < length; i++) {
        self[i] = ((subject[i] % 256) + 256) % 256
      }
    }
  } else if (type === 'string') {
    self.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT) {
    for (i = 0; i < length; i++) {
      self[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize) self.parent = rootParent

  return self
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, totalLength) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function byteLength (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, target_start, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - target_start < end - start) {
    end = target.length - target_start + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
module.exports = require('./lib/chai');

},{"./lib/chai":6}],6:[function(require,module,exports){
/*!
 * chai
 * Copyright(c) 2011-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

var used = []
  , exports = module.exports = {};

/*!
 * Chai version
 */

exports.version = '2.1.2';

/*!
 * Assertion Error
 */

exports.AssertionError = require('assertion-error');

/*!
 * Utils for plugins (not exported)
 */

var util = require('./chai/utils');

/**
 * # .use(function)
 *
 * Provides a way to extend the internals of Chai
 *
 * @param {Function}
 * @returns {this} for chaining
 * @api public
 */

exports.use = function (fn) {
  if (!~used.indexOf(fn)) {
    fn(this, util);
    used.push(fn);
  }

  return this;
};

/*!
 * Utility Functions
 */

exports.util = util;

/*!
 * Configuration
 */

var config = require('./chai/config');
exports.config = config;

/*!
 * Primary `Assertion` prototype
 */

var assertion = require('./chai/assertion');
exports.use(assertion);

/*!
 * Core Assertions
 */

var core = require('./chai/core/assertions');
exports.use(core);

/*!
 * Expect interface
 */

var expect = require('./chai/interface/expect');
exports.use(expect);

/*!
 * Should interface
 */

var should = require('./chai/interface/should');
exports.use(should);

/*!
 * Assert interface
 */

var assert = require('./chai/interface/assert');
exports.use(assert);

},{"./chai/assertion":7,"./chai/config":8,"./chai/core/assertions":9,"./chai/interface/assert":10,"./chai/interface/expect":11,"./chai/interface/should":12,"./chai/utils":25,"assertion-error":34}],7:[function(require,module,exports){
/*!
 * chai
 * http://chaijs.com
 * Copyright(c) 2011-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

var config = require('./config');

module.exports = function (_chai, util) {
  /*!
   * Module dependencies.
   */

  var AssertionError = _chai.AssertionError
    , flag = util.flag;

  /*!
   * Module export.
   */

  _chai.Assertion = Assertion;

  /*!
   * Assertion Constructor
   *
   * Creates object for chaining.
   *
   * @api private
   */

  function Assertion (obj, msg, stack) {
    flag(this, 'ssfi', stack || arguments.callee);
    flag(this, 'object', obj);
    flag(this, 'message', msg);
  }

  Object.defineProperty(Assertion, 'includeStack', {
    get: function() {
      console.warn('Assertion.includeStack is deprecated, use chai.config.includeStack instead.');
      return config.includeStack;
    },
    set: function(value) {
      console.warn('Assertion.includeStack is deprecated, use chai.config.includeStack instead.');
      config.includeStack = value;
    }
  });

  Object.defineProperty(Assertion, 'showDiff', {
    get: function() {
      console.warn('Assertion.showDiff is deprecated, use chai.config.showDiff instead.');
      return config.showDiff;
    },
    set: function(value) {
      console.warn('Assertion.showDiff is deprecated, use chai.config.showDiff instead.');
      config.showDiff = value;
    }
  });

  Assertion.addProperty = function (name, fn) {
    util.addProperty(this.prototype, name, fn);
  };

  Assertion.addMethod = function (name, fn) {
    util.addMethod(this.prototype, name, fn);
  };

  Assertion.addChainableMethod = function (name, fn, chainingBehavior) {
    util.addChainableMethod(this.prototype, name, fn, chainingBehavior);
  };

  Assertion.overwriteProperty = function (name, fn) {
    util.overwriteProperty(this.prototype, name, fn);
  };

  Assertion.overwriteMethod = function (name, fn) {
    util.overwriteMethod(this.prototype, name, fn);
  };

  Assertion.overwriteChainableMethod = function (name, fn, chainingBehavior) {
    util.overwriteChainableMethod(this.prototype, name, fn, chainingBehavior);
  };

  /*!
   * ### .assert(expression, message, negateMessage, expected, actual)
   *
   * Executes an expression and check expectations. Throws AssertionError for reporting if test doesn't pass.
   *
   * @name assert
   * @param {Philosophical} expression to be tested
   * @param {String or Function} message or function that returns message to display if expression fails
   * @param {String or Function} negatedMessage or function that returns negatedMessage to display if negated expression fails
   * @param {Mixed} expected value (remember to check for negation)
   * @param {Mixed} actual (optional) will default to `this.obj`
   * @param {Boolean} showDiff (optional) when set to `true`, assert will display a diff in addition to the message if expression fails
   * @api private
   */

  Assertion.prototype.assert = function (expr, msg, negateMsg, expected, _actual, showDiff) {
    var ok = util.test(this, arguments);
    if (true !== showDiff) showDiff = false;
    if (true !== config.showDiff) showDiff = false;

    if (!ok) {
      var msg = util.getMessage(this, arguments)
        , actual = util.getActual(this, arguments);
      throw new AssertionError(msg, {
          actual: actual
        , expected: expected
        , showDiff: showDiff
      }, (config.includeStack) ? this.assert : flag(this, 'ssfi'));
    }
  };

  /*!
   * ### ._obj
   *
   * Quick reference to stored `actual` value for plugin developers.
   *
   * @api private
   */

  Object.defineProperty(Assertion.prototype, '_obj',
    { get: function () {
        return flag(this, 'object');
      }
    , set: function (val) {
        flag(this, 'object', val);
      }
  });
};

},{"./config":8}],8:[function(require,module,exports){
module.exports = {

  /**
   * ### config.includeStack
   *
   * User configurable property, influences whether stack trace
   * is included in Assertion error message. Default of false
   * suppresses stack trace in the error message.
   *
   *     chai.config.includeStack = true;  // enable stack on error
   *
   * @param {Boolean}
   * @api public
   */

   includeStack: false,

  /**
   * ### config.showDiff
   *
   * User configurable property, influences whether or not
   * the `showDiff` flag should be included in the thrown
   * AssertionErrors. `false` will always be `false`; `true`
   * will be true when the assertion has requested a diff
   * be shown.
   *
   * @param {Boolean}
   * @api public
   */

  showDiff: true,

  /**
   * ### config.truncateThreshold
   *
   * User configurable property, sets length threshold for actual and
   * expected values in assertion errors. If this threshold is exceeded, for
   * example for large data structures, the value is replaced with something
   * like `[ Array(3) ]` or `{ Object (prop1, prop2) }`.
   *
   * Set it to zero if you want to disable truncating altogether.
   *
   * This is especially userful when doing assertions on arrays: having this
   * set to a reasonable large value makes the failure messages readily
   * inspectable.
   *
   *     chai.config.truncateThreshold = 0;  // disable truncating
   *
   * @param {Number}
   * @api public
   */

  truncateThreshold: 40

};

},{}],9:[function(require,module,exports){
/*!
 * chai
 * http://chaijs.com
 * Copyright(c) 2011-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

module.exports = function (chai, _) {
  var Assertion = chai.Assertion
    , toString = Object.prototype.toString
    , flag = _.flag;

  /**
   * ### Language Chains
   *
   * The following are provided as chainable getters to
   * improve the readability of your assertions. They
   * do not provide testing capabilities unless they
   * have been overwritten by a plugin.
   *
   * **Chains**
   *
   * - to
   * - be
   * - been
   * - is
   * - that
   * - which
   * - and
   * - has
   * - have
   * - with
   * - at
   * - of
   * - same
   *
   * @name language chains
   * @api public
   */

  [ 'to', 'be', 'been'
  , 'is', 'and', 'has', 'have'
  , 'with', 'that', 'which', 'at'
  , 'of', 'same' ].forEach(function (chain) {
    Assertion.addProperty(chain, function () {
      return this;
    });
  });

  /**
   * ### .not
   *
   * Negates any of assertions following in the chain.
   *
   *     expect(foo).to.not.equal('bar');
   *     expect(goodFn).to.not.throw(Error);
   *     expect({ foo: 'baz' }).to.have.property('foo')
   *       .and.not.equal('bar');
   *
   * @name not
   * @api public
   */

  Assertion.addProperty('not', function () {
    flag(this, 'negate', true);
  });

  /**
   * ### .deep
   *
   * Sets the `deep` flag, later used by the `equal` and
   * `property` assertions.
   *
   *     expect(foo).to.deep.equal({ bar: 'baz' });
   *     expect({ foo: { bar: { baz: 'quux' } } })
   *       .to.have.deep.property('foo.bar.baz', 'quux');
   *
   * @name deep
   * @api public
   */

  Assertion.addProperty('deep', function () {
    flag(this, 'deep', true);
  });

  /**
   * ### .any
   *
   * Sets the `any` flag, (opposite of the `all` flag)
   * later used in the `keys` assertion. 
   *
   *     expect(foo).to.have.any.keys('bar', 'baz');
   *
   * @name any
   * @api public
   */

  Assertion.addProperty('any', function () {
    flag(this, 'any', true);
    flag(this, 'all', false)
  });


  /**
   * ### .all
   *
   * Sets the `all` flag (opposite of the `any` flag) 
   * later used by the `keys` assertion.
   *
   *     expect(foo).to.have.all.keys('bar', 'baz');
   *
   * @name all
   * @api public
   */

  Assertion.addProperty('all', function () {
    flag(this, 'all', true);
    flag(this, 'any', false);
  });

  /**
   * ### .a(type)
   *
   * The `a` and `an` assertions are aliases that can be
   * used either as language chains or to assert a value's
   * type.
   *
   *     // typeof
   *     expect('test').to.be.a('string');
   *     expect({ foo: 'bar' }).to.be.an('object');
   *     expect(null).to.be.a('null');
   *     expect(undefined).to.be.an('undefined');
   *
   *     // language chain
   *     expect(foo).to.be.an.instanceof(Foo);
   *
   * @name a
   * @alias an
   * @param {String} type
   * @param {String} message _optional_
   * @api public
   */

  function an (type, msg) {
    if (msg) flag(this, 'message', msg);
    type = type.toLowerCase();
    var obj = flag(this, 'object')
      , article = ~[ 'a', 'e', 'i', 'o', 'u' ].indexOf(type.charAt(0)) ? 'an ' : 'a ';

    this.assert(
        type === _.type(obj)
      , 'expected #{this} to be ' + article + type
      , 'expected #{this} not to be ' + article + type
    );
  }

  Assertion.addChainableMethod('an', an);
  Assertion.addChainableMethod('a', an);

  /**
   * ### .include(value)
   *
   * The `include` and `contain` assertions can be used as either property
   * based language chains or as methods to assert the inclusion of an object
   * in an array or a substring in a string. When used as language chains,
   * they toggle the `contains` flag for the `keys` assertion.
   *
   *     expect([1,2,3]).to.include(2);
   *     expect('foobar').to.contain('foo');
   *     expect({ foo: 'bar', hello: 'universe' }).to.include.keys('foo');
   *
   * @name include
   * @alias contain
   * @alias includes
   * @alias contains
   * @param {Object|String|Number} obj
   * @param {String} message _optional_
   * @api public
   */

  function includeChainingBehavior () {
    flag(this, 'contains', true);
  }

  function include (val, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    var expected = false;
    if (_.type(obj) === 'array' && _.type(val) === 'object') {
      for (var i in obj) {
        if (_.eql(obj[i], val)) {
          expected = true;
          break;
        }
      }
    } else if (_.type(val) === 'object') {
      if (!flag(this, 'negate')) {
        for (var k in val) new Assertion(obj).property(k, val[k]);
        return;
      }
      var subset = {};
      for (var k in val) subset[k] = obj[k];
      expected = _.eql(subset, val);
    } else {
      expected = obj && ~obj.indexOf(val);
    }
    this.assert(
        expected
      , 'expected #{this} to include ' + _.inspect(val)
      , 'expected #{this} to not include ' + _.inspect(val));
  }

  Assertion.addChainableMethod('include', include, includeChainingBehavior);
  Assertion.addChainableMethod('contain', include, includeChainingBehavior);
  Assertion.addChainableMethod('contains', include, includeChainingBehavior);
  Assertion.addChainableMethod('includes', include, includeChainingBehavior);

  /**
   * ### .ok
   *
   * Asserts that the target is truthy.
   *
   *     expect('everthing').to.be.ok;
   *     expect(1).to.be.ok;
   *     expect(false).to.not.be.ok;
   *     expect(undefined).to.not.be.ok;
   *     expect(null).to.not.be.ok;
   *
   * @name ok
   * @api public
   */

  Assertion.addProperty('ok', function () {
    this.assert(
        flag(this, 'object')
      , 'expected #{this} to be truthy'
      , 'expected #{this} to be falsy');
  });

  /**
   * ### .true
   *
   * Asserts that the target is `true`.
   *
   *     expect(true).to.be.true;
   *     expect(1).to.not.be.true;
   *
   * @name true
   * @api public
   */

  Assertion.addProperty('true', function () {
    this.assert(
        true === flag(this, 'object')
      , 'expected #{this} to be true'
      , 'expected #{this} to be false'
      , this.negate ? false : true
    );
  });

  /**
   * ### .false
   *
   * Asserts that the target is `false`.
   *
   *     expect(false).to.be.false;
   *     expect(0).to.not.be.false;
   *
   * @name false
   * @api public
   */

  Assertion.addProperty('false', function () {
    this.assert(
        false === flag(this, 'object')
      , 'expected #{this} to be false'
      , 'expected #{this} to be true'
      , this.negate ? true : false
    );
  });

  /**
   * ### .null
   *
   * Asserts that the target is `null`.
   *
   *     expect(null).to.be.null;
   *     expect(undefined).not.to.be.null;
   *
   * @name null
   * @api public
   */

  Assertion.addProperty('null', function () {
    this.assert(
        null === flag(this, 'object')
      , 'expected #{this} to be null'
      , 'expected #{this} not to be null'
    );
  });

  /**
   * ### .undefined
   *
   * Asserts that the target is `undefined`.
   *
   *     expect(undefined).to.be.undefined;
   *     expect(null).to.not.be.undefined;
   *
   * @name undefined
   * @api public
   */

  Assertion.addProperty('undefined', function () {
    this.assert(
        undefined === flag(this, 'object')
      , 'expected #{this} to be undefined'
      , 'expected #{this} not to be undefined'
    );
  });

  /**
   * ### .exist
   *
   * Asserts that the target is neither `null` nor `undefined`.
   *
   *     var foo = 'hi'
   *       , bar = null
   *       , baz;
   *
   *     expect(foo).to.exist;
   *     expect(bar).to.not.exist;
   *     expect(baz).to.not.exist;
   *
   * @name exist
   * @api public
   */

  Assertion.addProperty('exist', function () {
    this.assert(
        null != flag(this, 'object')
      , 'expected #{this} to exist'
      , 'expected #{this} to not exist'
    );
  });


  /**
   * ### .empty
   *
   * Asserts that the target's length is `0`. For arrays and strings, it checks
   * the `length` property. For objects, it gets the count of
   * enumerable keys.
   *
   *     expect([]).to.be.empty;
   *     expect('').to.be.empty;
   *     expect({}).to.be.empty;
   *
   * @name empty
   * @api public
   */

  Assertion.addProperty('empty', function () {
    var obj = flag(this, 'object')
      , expected = obj;

    if (Array.isArray(obj) || 'string' === typeof object) {
      expected = obj.length;
    } else if (typeof obj === 'object') {
      expected = Object.keys(obj).length;
    }

    this.assert(
        !expected
      , 'expected #{this} to be empty'
      , 'expected #{this} not to be empty'
    );
  });

  /**
   * ### .arguments
   *
   * Asserts that the target is an arguments object.
   *
   *     function test () {
   *       expect(arguments).to.be.arguments;
   *     }
   *
   * @name arguments
   * @alias Arguments
   * @api public
   */

  function checkArguments () {
    var obj = flag(this, 'object')
      , type = Object.prototype.toString.call(obj);
    this.assert(
        '[object Arguments]' === type
      , 'expected #{this} to be arguments but got ' + type
      , 'expected #{this} to not be arguments'
    );
  }

  Assertion.addProperty('arguments', checkArguments);
  Assertion.addProperty('Arguments', checkArguments);

  /**
   * ### .equal(value)
   *
   * Asserts that the target is strictly equal (`===`) to `value`.
   * Alternately, if the `deep` flag is set, asserts that
   * the target is deeply equal to `value`.
   *
   *     expect('hello').to.equal('hello');
   *     expect(42).to.equal(42);
   *     expect(1).to.not.equal(true);
   *     expect({ foo: 'bar' }).to.not.equal({ foo: 'bar' });
   *     expect({ foo: 'bar' }).to.deep.equal({ foo: 'bar' });
   *
   * @name equal
   * @alias equals
   * @alias eq
   * @alias deep.equal
   * @param {Mixed} value
   * @param {String} message _optional_
   * @api public
   */

  function assertEqual (val, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    if (flag(this, 'deep')) {
      return this.eql(val);
    } else {
      this.assert(
          val === obj
        , 'expected #{this} to equal #{exp}'
        , 'expected #{this} to not equal #{exp}'
        , val
        , this._obj
        , true
      );
    }
  }

  Assertion.addMethod('equal', assertEqual);
  Assertion.addMethod('equals', assertEqual);
  Assertion.addMethod('eq', assertEqual);

  /**
   * ### .eql(value)
   *
   * Asserts that the target is deeply equal to `value`.
   *
   *     expect({ foo: 'bar' }).to.eql({ foo: 'bar' });
   *     expect([ 1, 2, 3 ]).to.eql([ 1, 2, 3 ]);
   *
   * @name eql
   * @alias eqls
   * @param {Mixed} value
   * @param {String} message _optional_
   * @api public
   */

  function assertEql(obj, msg) {
    if (msg) flag(this, 'message', msg);
    this.assert(
        _.eql(obj, flag(this, 'object'))
      , 'expected #{this} to deeply equal #{exp}'
      , 'expected #{this} to not deeply equal #{exp}'
      , obj
      , this._obj
      , true
    );
  }

  Assertion.addMethod('eql', assertEql);
  Assertion.addMethod('eqls', assertEql);

  /**
   * ### .above(value)
   *
   * Asserts that the target is greater than `value`.
   *
   *     expect(10).to.be.above(5);
   *
   * Can also be used in conjunction with `length` to
   * assert a minimum length. The benefit being a
   * more informative error message than if the length
   * was supplied directly.
   *
   *     expect('foo').to.have.length.above(2);
   *     expect([ 1, 2, 3 ]).to.have.length.above(2);
   *
   * @name above
   * @alias gt
   * @alias greaterThan
   * @param {Number} value
   * @param {String} message _optional_
   * @api public
   */

  function assertAbove (n, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    if (flag(this, 'doLength')) {
      new Assertion(obj, msg).to.have.property('length');
      var len = obj.length;
      this.assert(
          len > n
        , 'expected #{this} to have a length above #{exp} but got #{act}'
        , 'expected #{this} to not have a length above #{exp}'
        , n
        , len
      );
    } else {
      this.assert(
          obj > n
        , 'expected #{this} to be above ' + n
        , 'expected #{this} to be at most ' + n
      );
    }
  }

  Assertion.addMethod('above', assertAbove);
  Assertion.addMethod('gt', assertAbove);
  Assertion.addMethod('greaterThan', assertAbove);

  /**
   * ### .least(value)
   *
   * Asserts that the target is greater than or equal to `value`.
   *
   *     expect(10).to.be.at.least(10);
   *
   * Can also be used in conjunction with `length` to
   * assert a minimum length. The benefit being a
   * more informative error message than if the length
   * was supplied directly.
   *
   *     expect('foo').to.have.length.of.at.least(2);
   *     expect([ 1, 2, 3 ]).to.have.length.of.at.least(3);
   *
   * @name least
   * @alias gte
   * @param {Number} value
   * @param {String} message _optional_
   * @api public
   */

  function assertLeast (n, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    if (flag(this, 'doLength')) {
      new Assertion(obj, msg).to.have.property('length');
      var len = obj.length;
      this.assert(
          len >= n
        , 'expected #{this} to have a length at least #{exp} but got #{act}'
        , 'expected #{this} to have a length below #{exp}'
        , n
        , len
      );
    } else {
      this.assert(
          obj >= n
        , 'expected #{this} to be at least ' + n
        , 'expected #{this} to be below ' + n
      );
    }
  }

  Assertion.addMethod('least', assertLeast);
  Assertion.addMethod('gte', assertLeast);

  /**
   * ### .below(value)
   *
   * Asserts that the target is less than `value`.
   *
   *     expect(5).to.be.below(10);
   *
   * Can also be used in conjunction with `length` to
   * assert a maximum length. The benefit being a
   * more informative error message than if the length
   * was supplied directly.
   *
   *     expect('foo').to.have.length.below(4);
   *     expect([ 1, 2, 3 ]).to.have.length.below(4);
   *
   * @name below
   * @alias lt
   * @alias lessThan
   * @param {Number} value
   * @param {String} message _optional_
   * @api public
   */

  function assertBelow (n, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    if (flag(this, 'doLength')) {
      new Assertion(obj, msg).to.have.property('length');
      var len = obj.length;
      this.assert(
          len < n
        , 'expected #{this} to have a length below #{exp} but got #{act}'
        , 'expected #{this} to not have a length below #{exp}'
        , n
        , len
      );
    } else {
      this.assert(
          obj < n
        , 'expected #{this} to be below ' + n
        , 'expected #{this} to be at least ' + n
      );
    }
  }

  Assertion.addMethod('below', assertBelow);
  Assertion.addMethod('lt', assertBelow);
  Assertion.addMethod('lessThan', assertBelow);

  /**
   * ### .most(value)
   *
   * Asserts that the target is less than or equal to `value`.
   *
   *     expect(5).to.be.at.most(5);
   *
   * Can also be used in conjunction with `length` to
   * assert a maximum length. The benefit being a
   * more informative error message than if the length
   * was supplied directly.
   *
   *     expect('foo').to.have.length.of.at.most(4);
   *     expect([ 1, 2, 3 ]).to.have.length.of.at.most(3);
   *
   * @name most
   * @alias lte
   * @param {Number} value
   * @param {String} message _optional_
   * @api public
   */

  function assertMost (n, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    if (flag(this, 'doLength')) {
      new Assertion(obj, msg).to.have.property('length');
      var len = obj.length;
      this.assert(
          len <= n
        , 'expected #{this} to have a length at most #{exp} but got #{act}'
        , 'expected #{this} to have a length above #{exp}'
        , n
        , len
      );
    } else {
      this.assert(
          obj <= n
        , 'expected #{this} to be at most ' + n
        , 'expected #{this} to be above ' + n
      );
    }
  }

  Assertion.addMethod('most', assertMost);
  Assertion.addMethod('lte', assertMost);

  /**
   * ### .within(start, finish)
   *
   * Asserts that the target is within a range.
   *
   *     expect(7).to.be.within(5,10);
   *
   * Can also be used in conjunction with `length` to
   * assert a length range. The benefit being a
   * more informative error message than if the length
   * was supplied directly.
   *
   *     expect('foo').to.have.length.within(2,4);
   *     expect([ 1, 2, 3 ]).to.have.length.within(2,4);
   *
   * @name within
   * @param {Number} start lowerbound inclusive
   * @param {Number} finish upperbound inclusive
   * @param {String} message _optional_
   * @api public
   */

  Assertion.addMethod('within', function (start, finish, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object')
      , range = start + '..' + finish;
    if (flag(this, 'doLength')) {
      new Assertion(obj, msg).to.have.property('length');
      var len = obj.length;
      this.assert(
          len >= start && len <= finish
        , 'expected #{this} to have a length within ' + range
        , 'expected #{this} to not have a length within ' + range
      );
    } else {
      this.assert(
          obj >= start && obj <= finish
        , 'expected #{this} to be within ' + range
        , 'expected #{this} to not be within ' + range
      );
    }
  });

  /**
   * ### .instanceof(constructor)
   *
   * Asserts that the target is an instance of `constructor`.
   *
   *     var Tea = function (name) { this.name = name; }
   *       , Chai = new Tea('chai');
   *
   *     expect(Chai).to.be.an.instanceof(Tea);
   *     expect([ 1, 2, 3 ]).to.be.instanceof(Array);
   *
   * @name instanceof
   * @param {Constructor} constructor
   * @param {String} message _optional_
   * @alias instanceOf
   * @api public
   */

  function assertInstanceOf (constructor, msg) {
    if (msg) flag(this, 'message', msg);
    var name = _.getName(constructor);
    this.assert(
        flag(this, 'object') instanceof constructor
      , 'expected #{this} to be an instance of ' + name
      , 'expected #{this} to not be an instance of ' + name
    );
  };

  Assertion.addMethod('instanceof', assertInstanceOf);
  Assertion.addMethod('instanceOf', assertInstanceOf);

  /**
   * ### .property(name, [value])
   *
   * Asserts that the target has a property `name`, optionally asserting that
   * the value of that property is strictly equal to  `value`.
   * If the `deep` flag is set, you can use dot- and bracket-notation for deep
   * references into objects and arrays.
   *
   *     // simple referencing
   *     var obj = { foo: 'bar' };
   *     expect(obj).to.have.property('foo');
   *     expect(obj).to.have.property('foo', 'bar');
   *
   *     // deep referencing
   *     var deepObj = {
   *         green: { tea: 'matcha' }
   *       , teas: [ 'chai', 'matcha', { tea: 'konacha' } ]
   *     };

   *     expect(deepObj).to.have.deep.property('green.tea', 'matcha');
   *     expect(deepObj).to.have.deep.property('teas[1]', 'matcha');
   *     expect(deepObj).to.have.deep.property('teas[2].tea', 'konacha');
   *
   * You can also use an array as the starting point of a `deep.property`
   * assertion, or traverse nested arrays.
   *
   *     var arr = [
   *         [ 'chai', 'matcha', 'konacha' ]
   *       , [ { tea: 'chai' }
   *         , { tea: 'matcha' }
   *         , { tea: 'konacha' } ]
   *     ];
   *
   *     expect(arr).to.have.deep.property('[0][1]', 'matcha');
   *     expect(arr).to.have.deep.property('[1][2].tea', 'konacha');
   *
   * Furthermore, `property` changes the subject of the assertion
   * to be the value of that property from the original object. This
   * permits for further chainable assertions on that property.
   *
   *     expect(obj).to.have.property('foo')
   *       .that.is.a('string');
   *     expect(deepObj).to.have.property('green')
   *       .that.is.an('object')
   *       .that.deep.equals({ tea: 'matcha' });
   *     expect(deepObj).to.have.property('teas')
   *       .that.is.an('array')
   *       .with.deep.property('[2]')
   *         .that.deep.equals({ tea: 'konacha' });
   *
   * @name property
   * @alias deep.property
   * @param {String} name
   * @param {Mixed} value (optional)
   * @param {String} message _optional_
   * @returns value of property for chaining
   * @api public
   */

  Assertion.addMethod('property', function (name, val, msg) {
    if (msg) flag(this, 'message', msg);

    var isDeep = !!flag(this, 'deep')
      , descriptor = isDeep ? 'deep property ' : 'property '
      , negate = flag(this, 'negate')
      , obj = flag(this, 'object')
      , pathInfo = isDeep ? _.getPathInfo(name, obj) : null
      , hasProperty = isDeep
        ? pathInfo.exists
        : _.hasProperty(name, obj)
      , value = isDeep
        ? pathInfo.value
        : obj[name];

    if (negate && undefined !== val) {
      if (undefined === value) {
        msg = (msg != null) ? msg + ': ' : '';
        throw new Error(msg + _.inspect(obj) + ' has no ' + descriptor + _.inspect(name));
      }
    } else {
      this.assert(
          hasProperty
        , 'expected #{this} to have a ' + descriptor + _.inspect(name)
        , 'expected #{this} to not have ' + descriptor + _.inspect(name));
    }

    if (undefined !== val) {
      this.assert(
          val === value
        , 'expected #{this} to have a ' + descriptor + _.inspect(name) + ' of #{exp}, but got #{act}'
        , 'expected #{this} to not have a ' + descriptor + _.inspect(name) + ' of #{act}'
        , val
        , value
      );
    }

    flag(this, 'object', value);
  });


  /**
   * ### .ownProperty(name)
   *
   * Asserts that the target has an own property `name`.
   *
   *     expect('test').to.have.ownProperty('length');
   *
   * @name ownProperty
   * @alias haveOwnProperty
   * @param {String} name
   * @param {String} message _optional_
   * @api public
   */

  function assertOwnProperty (name, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    this.assert(
        obj.hasOwnProperty(name)
      , 'expected #{this} to have own property ' + _.inspect(name)
      , 'expected #{this} to not have own property ' + _.inspect(name)
    );
  }

  Assertion.addMethod('ownProperty', assertOwnProperty);
  Assertion.addMethod('haveOwnProperty', assertOwnProperty);

  /**
   * ### .length(value)
   *
   * Asserts that the target's `length` property has
   * the expected value.
   *
   *     expect([ 1, 2, 3]).to.have.length(3);
   *     expect('foobar').to.have.length(6);
   *
   * Can also be used as a chain precursor to a value
   * comparison for the length property.
   *
   *     expect('foo').to.have.length.above(2);
   *     expect([ 1, 2, 3 ]).to.have.length.above(2);
   *     expect('foo').to.have.length.below(4);
   *     expect([ 1, 2, 3 ]).to.have.length.below(4);
   *     expect('foo').to.have.length.within(2,4);
   *     expect([ 1, 2, 3 ]).to.have.length.within(2,4);
   *
   * @name length
   * @alias lengthOf
   * @param {Number} length
   * @param {String} message _optional_
   * @api public
   */

  function assertLengthChain () {
    flag(this, 'doLength', true);
  }

  function assertLength (n, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    new Assertion(obj, msg).to.have.property('length');
    var len = obj.length;

    this.assert(
        len == n
      , 'expected #{this} to have a length of #{exp} but got #{act}'
      , 'expected #{this} to not have a length of #{act}'
      , n
      , len
    );
  }

  Assertion.addChainableMethod('length', assertLength, assertLengthChain);
  Assertion.addMethod('lengthOf', assertLength);

  /**
   * ### .match(regexp)
   *
   * Asserts that the target matches a regular expression.
   *
   *     expect('foobar').to.match(/^foo/);
   *
   * @name match
   * @param {RegExp} RegularExpression
   * @param {String} message _optional_
   * @api public
   */

  Assertion.addMethod('match', function (re, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    this.assert(
        re.exec(obj)
      , 'expected #{this} to match ' + re
      , 'expected #{this} not to match ' + re
    );
  });

  /**
   * ### .string(string)
   *
   * Asserts that the string target contains another string.
   *
   *     expect('foobar').to.have.string('bar');
   *
   * @name string
   * @param {String} string
   * @param {String} message _optional_
   * @api public
   */

  Assertion.addMethod('string', function (str, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    new Assertion(obj, msg).is.a('string');

    this.assert(
        ~obj.indexOf(str)
      , 'expected #{this} to contain ' + _.inspect(str)
      , 'expected #{this} to not contain ' + _.inspect(str)
    );
  });


  /**
   * ### .keys(key1, [key2], [...])
   *
   * Asserts that the target contains any or all of the passed-in keys.
   * Use in combination with `any`, `all`, `contains`, or `have` will affect 
   * what will pass.
   * 
   * When used in conjunction with `any`, at least one key that is passed 
   * in must exist in the target object. This is regardless whether or not 
   * the `have` or `contain` qualifiers are used. Note, either `any` or `all`
   * should be used in the assertion. If neither are used, the assertion is
   * defaulted to `all`.
   * 
   * When both `all` and `contain` are used, the target object must have at 
   * least all of the passed-in keys but may have more keys not listed.
   * 
   * When both `all` and `have` are used, the target object must both contain
   * all of the passed-in keys AND the number of keys in the target object must
   * match the number of keys passed in (in other words, a target object must 
   * have all and only all of the passed-in keys).
   * 
   *     expect({ foo: 1, bar: 2 }).to.have.any.keys('foo', 'baz');
   *     expect({ foo: 1, bar: 2 }).to.have.any.keys('foo');
   *     expect({ foo: 1, bar: 2 }).to.contain.any.keys('bar', 'baz');
   *     expect({ foo: 1, bar: 2 }).to.contain.any.keys(['foo']);
   *     expect({ foo: 1, bar: 2 }).to.contain.any.keys({'foo': 6});
   *     expect({ foo: 1, bar: 2 }).to.have.all.keys(['bar', 'foo']);
   *     expect({ foo: 1, bar: 2 }).to.have.all.keys({'bar': 6, 'foo', 7});
   *     expect({ foo: 1, bar: 2, baz: 3 }).to.contain.all.keys(['bar', 'foo']);
   *     expect({ foo: 1, bar: 2, baz: 3 }).to.contain.all.keys([{'bar': 6}}]);
   *
   *
   * @name keys
   * @alias key
   * @param {String...|Array|Object} keys
   * @api public
   */

  function assertKeys (keys) {
    var obj = flag(this, 'object')
      , str
      , ok = true
      , mixedArgsMsg = 'keys must be given single argument of Array|Object|String, or multiple String arguments';

    switch (_.type(keys)) {
      case "array":
        if (arguments.length > 1) throw (new Error(mixedArgsMsg));
        break;
      case "object":
        if (arguments.length > 1) throw (new Error(mixedArgsMsg));
        keys = Object.keys(keys);
        break;
      default:
        keys = Array.prototype.slice.call(arguments);
    }

    if (!keys.length) throw new Error('keys required');

    var actual = Object.keys(obj)
      , expected = keys
      , len = keys.length
      , any = flag(this, 'any')
      , all = flag(this, 'all');

    if (!any && !all) {
      all = true;
    }

    // Has any
    if (any) {
      var intersection = expected.filter(function(key) {
        return ~actual.indexOf(key);
      });
      ok = intersection.length > 0;
    }

    // Has all
    if (all) {
      ok = keys.every(function(key){
        return ~actual.indexOf(key);
      });
      if (!flag(this, 'negate') && !flag(this, 'contains')) {
        ok = ok && keys.length == actual.length;
      }
    }

    // Key string
    if (len > 1) {
      keys = keys.map(function(key){
        return _.inspect(key);
      });
      var last = keys.pop();
      if (all) {
        str = keys.join(', ') + ', and ' + last;
      }
      if (any) {
        str = keys.join(', ') + ', or ' + last;
      }
    } else {
      str = _.inspect(keys[0]);
    }

    // Form
    str = (len > 1 ? 'keys ' : 'key ') + str;

    // Have / include
    str = (flag(this, 'contains') ? 'contain ' : 'have ') + str;

    // Assertion
    this.assert(
        ok
      , 'expected #{this} to ' + str
      , 'expected #{this} to not ' + str
      , expected.slice(0).sort()
      , actual.sort()
      , true
    );
  }

  Assertion.addMethod('keys', assertKeys);
  Assertion.addMethod('key', assertKeys);

  /**
   * ### .throw(constructor)
   *
   * Asserts that the function target will throw a specific error, or specific type of error
   * (as determined using `instanceof`), optionally with a RegExp or string inclusion test
   * for the error's message.
   *
   *     var err = new ReferenceError('This is a bad function.');
   *     var fn = function () { throw err; }
   *     expect(fn).to.throw(ReferenceError);
   *     expect(fn).to.throw(Error);
   *     expect(fn).to.throw(/bad function/);
   *     expect(fn).to.not.throw('good function');
   *     expect(fn).to.throw(ReferenceError, /bad function/);
   *     expect(fn).to.throw(err);
   *     expect(fn).to.not.throw(new RangeError('Out of range.'));
   *
   * Please note that when a throw expectation is negated, it will check each
   * parameter independently, starting with error constructor type. The appropriate way
   * to check for the existence of a type of error but for a message that does not match
   * is to use `and`.
   *
   *     expect(fn).to.throw(ReferenceError)
   *        .and.not.throw(/good function/);
   *
   * @name throw
   * @alias throws
   * @alias Throw
   * @param {ErrorConstructor} constructor
   * @param {String|RegExp} expected error message
   * @param {String} message _optional_
   * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Error#Error_types
   * @returns error for chaining (null if no error)
   * @api public
   */

  function assertThrows (constructor, errMsg, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    new Assertion(obj, msg).is.a('function');

    var thrown = false
      , desiredError = null
      , name = null
      , thrownError = null;

    if (arguments.length === 0) {
      errMsg = null;
      constructor = null;
    } else if (constructor && (constructor instanceof RegExp || 'string' === typeof constructor)) {
      errMsg = constructor;
      constructor = null;
    } else if (constructor && constructor instanceof Error) {
      desiredError = constructor;
      constructor = null;
      errMsg = null;
    } else if (typeof constructor === 'function') {
      name = constructor.prototype.name || constructor.name;
      if (name === 'Error' && constructor !== Error) {
        name = (new constructor()).name;
      }
    } else {
      constructor = null;
    }

    try {
      obj();
    } catch (err) {
      // first, check desired error
      if (desiredError) {
        this.assert(
            err === desiredError
          , 'expected #{this} to throw #{exp} but #{act} was thrown'
          , 'expected #{this} to not throw #{exp}'
          , (desiredError instanceof Error ? desiredError.toString() : desiredError)
          , (err instanceof Error ? err.toString() : err)
        );

        flag(this, 'object', err);
        return this;
      }

      // next, check constructor
      if (constructor) {
        this.assert(
            err instanceof constructor
          , 'expected #{this} to throw #{exp} but #{act} was thrown'
          , 'expected #{this} to not throw #{exp} but #{act} was thrown'
          , name
          , (err instanceof Error ? err.toString() : err)
        );

        if (!errMsg) {
          flag(this, 'object', err);
          return this;
        }
      }

      // next, check message
      var message = 'object' === _.type(err) && "message" in err
        ? err.message
        : '' + err;

      if ((message != null) && errMsg && errMsg instanceof RegExp) {
        this.assert(
            errMsg.exec(message)
          , 'expected #{this} to throw error matching #{exp} but got #{act}'
          , 'expected #{this} to throw error not matching #{exp}'
          , errMsg
          , message
        );

        flag(this, 'object', err);
        return this;
      } else if ((message != null) && errMsg && 'string' === typeof errMsg) {
        this.assert(
            ~message.indexOf(errMsg)
          , 'expected #{this} to throw error including #{exp} but got #{act}'
          , 'expected #{this} to throw error not including #{act}'
          , errMsg
          , message
        );

        flag(this, 'object', err);
        return this;
      } else {
        thrown = true;
        thrownError = err;
      }
    }

    var actuallyGot = ''
      , expectedThrown = name !== null
        ? name
        : desiredError
          ? '#{exp}' //_.inspect(desiredError)
          : 'an error';

    if (thrown) {
      actuallyGot = ' but #{act} was thrown'
    }

    this.assert(
        thrown === true
      , 'expected #{this} to throw ' + expectedThrown + actuallyGot
      , 'expected #{this} to not throw ' + expectedThrown + actuallyGot
      , (desiredError instanceof Error ? desiredError.toString() : desiredError)
      , (thrownError instanceof Error ? thrownError.toString() : thrownError)
    );

    flag(this, 'object', thrownError);
  };

  Assertion.addMethod('throw', assertThrows);
  Assertion.addMethod('throws', assertThrows);
  Assertion.addMethod('Throw', assertThrows);

  /**
   * ### .respondTo(method)
   *
   * Asserts that the object or class target will respond to a method.
   *
   *     Klass.prototype.bar = function(){};
   *     expect(Klass).to.respondTo('bar');
   *     expect(obj).to.respondTo('bar');
   *
   * To check if a constructor will respond to a static function,
   * set the `itself` flag.
   *
   *     Klass.baz = function(){};
   *     expect(Klass).itself.to.respondTo('baz');
   *
   * @name respondTo
   * @param {String} method
   * @param {String} message _optional_
   * @api public
   */

  Assertion.addMethod('respondTo', function (method, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object')
      , itself = flag(this, 'itself')
      , context = ('function' === _.type(obj) && !itself)
        ? obj.prototype[method]
        : obj[method];

    this.assert(
        'function' === typeof context
      , 'expected #{this} to respond to ' + _.inspect(method)
      , 'expected #{this} to not respond to ' + _.inspect(method)
    );
  });

  /**
   * ### .itself
   *
   * Sets the `itself` flag, later used by the `respondTo` assertion.
   *
   *     function Foo() {}
   *     Foo.bar = function() {}
   *     Foo.prototype.baz = function() {}
   *
   *     expect(Foo).itself.to.respondTo('bar');
   *     expect(Foo).itself.not.to.respondTo('baz');
   *
   * @name itself
   * @api public
   */

  Assertion.addProperty('itself', function () {
    flag(this, 'itself', true);
  });

  /**
   * ### .satisfy(method)
   *
   * Asserts that the target passes a given truth test.
   *
   *     expect(1).to.satisfy(function(num) { return num > 0; });
   *
   * @name satisfy
   * @param {Function} matcher
   * @param {String} message _optional_
   * @api public
   */

  Assertion.addMethod('satisfy', function (matcher, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');
    var result = matcher(obj);
    this.assert(
        result
      , 'expected #{this} to satisfy ' + _.objDisplay(matcher)
      , 'expected #{this} to not satisfy' + _.objDisplay(matcher)
      , this.negate ? false : true
      , result
    );
  });

  /**
   * ### .closeTo(expected, delta)
   *
   * Asserts that the target is equal `expected`, to within a +/- `delta` range.
   *
   *     expect(1.5).to.be.closeTo(1, 0.5);
   *
   * @name closeTo
   * @param {Number} expected
   * @param {Number} delta
   * @param {String} message _optional_
   * @api public
   */

  Assertion.addMethod('closeTo', function (expected, delta, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');

    new Assertion(obj, msg).is.a('number');
    if (_.type(expected) !== 'number' || _.type(delta) !== 'number') {
      throw new Error('the arguments to closeTo must be numbers');
    }

    this.assert(
        Math.abs(obj - expected) <= delta
      , 'expected #{this} to be close to ' + expected + ' +/- ' + delta
      , 'expected #{this} not to be close to ' + expected + ' +/- ' + delta
    );
  });

  function isSubsetOf(subset, superset, cmp) {
    return subset.every(function(elem) {
      if (!cmp) return superset.indexOf(elem) !== -1;

      return superset.some(function(elem2) {
        return cmp(elem, elem2);
      });
    })
  }

  /**
   * ### .members(set)
   *
   * Asserts that the target is a superset of `set`,
   * or that the target and `set` have the same strictly-equal (===) members.
   * Alternately, if the `deep` flag is set, set members are compared for deep
   * equality.
   *
   *     expect([1, 2, 3]).to.include.members([3, 2]);
   *     expect([1, 2, 3]).to.not.include.members([3, 2, 8]);
   *
   *     expect([4, 2]).to.have.members([2, 4]);
   *     expect([5, 2]).to.not.have.members([5, 2, 1]);
   *
   *     expect([{ id: 1 }]).to.deep.include.members([{ id: 1 }]);
   *
   * @name members
   * @param {Array} set
   * @param {String} message _optional_
   * @api public
   */

  Assertion.addMethod('members', function (subset, msg) {
    if (msg) flag(this, 'message', msg);
    var obj = flag(this, 'object');

    new Assertion(obj).to.be.an('array');
    new Assertion(subset).to.be.an('array');

    var cmp = flag(this, 'deep') ? _.eql : undefined;

    if (flag(this, 'contains')) {
      return this.assert(
          isSubsetOf(subset, obj, cmp)
        , 'expected #{this} to be a superset of #{act}'
        , 'expected #{this} to not be a superset of #{act}'
        , obj
        , subset
      );
    }

    this.assert(
        isSubsetOf(obj, subset, cmp) && isSubsetOf(subset, obj, cmp)
        , 'expected #{this} to have the same members as #{act}'
        , 'expected #{this} to not have the same members as #{act}'
        , obj
        , subset
    );
  });

  /**
   * ### .change(function)
   *
   * Asserts that a function changes an object property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val += 3 };
   *     var noChangeFn = function() { return 'foo' + 'bar'; }
   *     expect(fn).to.change(obj, 'val');
   *     expect(noChangFn).to.not.change(obj, 'val')
   *
   * @name change
   * @alias changes
   * @alias Change
   * @param {String} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  function assertChanges (object, prop, msg) {
    if (msg) flag(this, 'message', msg);
    var fn = flag(this, 'object');
    new Assertion(object, msg).to.have.property(prop);
    new Assertion(fn).is.a('function');

    var initial = object[prop];
    fn();

    this.assert(
      initial !== object[prop]
      , 'expected .' + prop + ' to change'
      , 'expected .' + prop + ' to not change'
    );
  }

  Assertion.addChainableMethod('change', assertChanges);
  Assertion.addChainableMethod('changes', assertChanges);

  /**
   * ### .increase(function)
   *
   * Asserts that a function increases an object property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val = 15 };
   *     expect(fn).to.increase(obj, 'val');
   *
   * @name increase
   * @alias increases
   * @alias Increase
   * @param {String} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  function assertIncreases (object, prop, msg) {
    if (msg) flag(this, 'message', msg);
    var fn = flag(this, 'object');
    new Assertion(object, msg).to.have.property(prop);
    new Assertion(fn).is.a('function');

    var initial = object[prop];
    fn();

    this.assert(
      object[prop] - initial > 0
      , 'expected .' + prop + ' to increase'
      , 'expected .' + prop + ' to not increase'
    );
  }

  Assertion.addChainableMethod('increase', assertIncreases);
  Assertion.addChainableMethod('increases', assertIncreases);

  /**
   * ### .decrease(function)
   *
   * Asserts that a function decreases an object property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val = 5 };
   *     expect(fn).to.decrease(obj, 'val');
   *
   * @name decrease
   * @alias decreases
   * @alias Decrease
   * @param {String} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  function assertDecreases (object, prop, msg) {
    if (msg) flag(this, 'message', msg);
    var fn = flag(this, 'object');
    new Assertion(object, msg).to.have.property(prop);
    new Assertion(fn).is.a('function');

    var initial = object[prop];
    fn();

    this.assert(
      object[prop] - initial < 0
      , 'expected .' + prop + ' to decrease'
      , 'expected .' + prop + ' to not decrease'
    );
  }

  Assertion.addChainableMethod('decrease', assertDecreases);
  Assertion.addChainableMethod('decreases', assertDecreases);

};

},{}],10:[function(require,module,exports){
/*!
 * chai
 * Copyright(c) 2011-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */


module.exports = function (chai, util) {

  /*!
   * Chai dependencies.
   */

  var Assertion = chai.Assertion
    , flag = util.flag;

  /*!
   * Module export.
   */

  /**
   * ### assert(expression, message)
   *
   * Write your own test expressions.
   *
   *     assert('foo' !== 'bar', 'foo is not bar');
   *     assert(Array.isArray([]), 'empty arrays are arrays');
   *
   * @param {Mixed} expression to test for truthiness
   * @param {String} message to display on error
   * @name assert
   * @api public
   */

  var assert = chai.assert = function (express, errmsg) {
    var test = new Assertion(null, null, chai.assert);
    test.assert(
        express
      , errmsg
      , '[ negation message unavailable ]'
    );
  };

  /**
   * ### .fail(actual, expected, [message], [operator])
   *
   * Throw a failure. Node.js `assert` module-compatible.
   *
   * @name fail
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @param {String} operator
   * @api public
   */

  assert.fail = function (actual, expected, message, operator) {
    message = message || 'assert.fail()';
    throw new chai.AssertionError(message, {
        actual: actual
      , expected: expected
      , operator: operator
    }, assert.fail);
  };

  /**
   * ### .ok(object, [message])
   *
   * Asserts that `object` is truthy.
   *
   *     assert.ok('everything', 'everything is ok');
   *     assert.ok(false, 'this will fail');
   *
   * @name ok
   * @param {Mixed} object to test
   * @param {String} message
   * @api public
   */

  assert.ok = function (val, msg) {
    new Assertion(val, msg).is.ok;
  };

  /**
   * ### .notOk(object, [message])
   *
   * Asserts that `object` is falsy.
   *
   *     assert.notOk('everything', 'this will fail');
   *     assert.notOk(false, 'this will pass');
   *
   * @name notOk
   * @param {Mixed} object to test
   * @param {String} message
   * @api public
   */

  assert.notOk = function (val, msg) {
    new Assertion(val, msg).is.not.ok;
  };

  /**
   * ### .equal(actual, expected, [message])
   *
   * Asserts non-strict equality (`==`) of `actual` and `expected`.
   *
   *     assert.equal(3, '3', '== coerces values to strings');
   *
   * @name equal
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @api public
   */

  assert.equal = function (act, exp, msg) {
    var test = new Assertion(act, msg, assert.equal);

    test.assert(
        exp == flag(test, 'object')
      , 'expected #{this} to equal #{exp}'
      , 'expected #{this} to not equal #{act}'
      , exp
      , act
    );
  };

  /**
   * ### .notEqual(actual, expected, [message])
   *
   * Asserts non-strict inequality (`!=`) of `actual` and `expected`.
   *
   *     assert.notEqual(3, 4, 'these numbers are not equal');
   *
   * @name notEqual
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @api public
   */

  assert.notEqual = function (act, exp, msg) {
    var test = new Assertion(act, msg, assert.notEqual);

    test.assert(
        exp != flag(test, 'object')
      , 'expected #{this} to not equal #{exp}'
      , 'expected #{this} to equal #{act}'
      , exp
      , act
    );
  };

  /**
   * ### .strictEqual(actual, expected, [message])
   *
   * Asserts strict equality (`===`) of `actual` and `expected`.
   *
   *     assert.strictEqual(true, true, 'these booleans are strictly equal');
   *
   * @name strictEqual
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @api public
   */

  assert.strictEqual = function (act, exp, msg) {
    new Assertion(act, msg).to.equal(exp);
  };

  /**
   * ### .notStrictEqual(actual, expected, [message])
   *
   * Asserts strict inequality (`!==`) of `actual` and `expected`.
   *
   *     assert.notStrictEqual(3, '3', 'no coercion for strict equality');
   *
   * @name notStrictEqual
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @api public
   */

  assert.notStrictEqual = function (act, exp, msg) {
    new Assertion(act, msg).to.not.equal(exp);
  };

  /**
   * ### .deepEqual(actual, expected, [message])
   *
   * Asserts that `actual` is deeply equal to `expected`.
   *
   *     assert.deepEqual({ tea: 'green' }, { tea: 'green' });
   *
   * @name deepEqual
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @api public
   */

  assert.deepEqual = function (act, exp, msg) {
    new Assertion(act, msg).to.eql(exp);
  };

  /**
   * ### .notDeepEqual(actual, expected, [message])
   *
   * Assert that `actual` is not deeply equal to `expected`.
   *
   *     assert.notDeepEqual({ tea: 'green' }, { tea: 'jasmine' });
   *
   * @name notDeepEqual
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @api public
   */

  assert.notDeepEqual = function (act, exp, msg) {
    new Assertion(act, msg).to.not.eql(exp);
  };

  /**
   * ### .isTrue(value, [message])
   *
   * Asserts that `value` is true.
   *
   *     var teaServed = true;
   *     assert.isTrue(teaServed, 'the tea has been served');
   *
   * @name isTrue
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isAbove = function (val, abv, msg) {
    new Assertion(val, msg).to.be.above(abv);
  };

   /**
   * ### .isAbove(valueToCheck, valueToBeAbove, [message])
   *
   * Asserts `valueToCheck` is strictly greater than (>) `valueToBeAbove`
   *
   *     assert.isAbove(5, 2, '5 is strictly greater than 2');
   *
   * @name isAbove
   * @param {Mixed} valueToCheck
   * @param {Mixed} valueToBeAbove
   * @param {String} message
   * @api public
   */

  assert.isBelow = function (val, blw, msg) {
    new Assertion(val, msg).to.be.below(blw);
  };

   /**
   * ### .isBelow(valueToCheck, valueToBeBelow, [message])
   *
   * Asserts `valueToCheck` is strictly less than (<) `valueToBeBelow`
   *
   *     assert.isBelow(3, 6, '3 is strictly less than 6');
   *
   * @name isBelow
   * @param {Mixed} valueToCheck
   * @param {Mixed} valueToBeBelow
   * @param {String} message
   * @api public
   */

  assert.isTrue = function (val, msg) {
    new Assertion(val, msg).is['true'];
  };

  /**
   * ### .isFalse(value, [message])
   *
   * Asserts that `value` is false.
   *
   *     var teaServed = false;
   *     assert.isFalse(teaServed, 'no tea yet? hmm...');
   *
   * @name isFalse
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isFalse = function (val, msg) {
    new Assertion(val, msg).is['false'];
  };

  /**
   * ### .isNull(value, [message])
   *
   * Asserts that `value` is null.
   *
   *     assert.isNull(err, 'there was no error');
   *
   * @name isNull
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNull = function (val, msg) {
    new Assertion(val, msg).to.equal(null);
  };

  /**
   * ### .isNotNull(value, [message])
   *
   * Asserts that `value` is not null.
   *
   *     var tea = 'tasty chai';
   *     assert.isNotNull(tea, 'great, time for tea!');
   *
   * @name isNotNull
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNotNull = function (val, msg) {
    new Assertion(val, msg).to.not.equal(null);
  };

  /**
   * ### .isUndefined(value, [message])
   *
   * Asserts that `value` is `undefined`.
   *
   *     var tea;
   *     assert.isUndefined(tea, 'no tea defined');
   *
   * @name isUndefined
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isUndefined = function (val, msg) {
    new Assertion(val, msg).to.equal(undefined);
  };

  /**
   * ### .isDefined(value, [message])
   *
   * Asserts that `value` is not `undefined`.
   *
   *     var tea = 'cup of chai';
   *     assert.isDefined(tea, 'tea has been defined');
   *
   * @name isDefined
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isDefined = function (val, msg) {
    new Assertion(val, msg).to.not.equal(undefined);
  };

  /**
   * ### .isFunction(value, [message])
   *
   * Asserts that `value` is a function.
   *
   *     function serveTea() { return 'cup of tea'; };
   *     assert.isFunction(serveTea, 'great, we can have tea now');
   *
   * @name isFunction
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isFunction = function (val, msg) {
    new Assertion(val, msg).to.be.a('function');
  };

  /**
   * ### .isNotFunction(value, [message])
   *
   * Asserts that `value` is _not_ a function.
   *
   *     var serveTea = [ 'heat', 'pour', 'sip' ];
   *     assert.isNotFunction(serveTea, 'great, we have listed the steps');
   *
   * @name isNotFunction
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNotFunction = function (val, msg) {
    new Assertion(val, msg).to.not.be.a('function');
  };

  /**
   * ### .isObject(value, [message])
   *
   * Asserts that `value` is an object (as revealed by
   * `Object.prototype.toString`).
   *
   *     var selection = { name: 'Chai', serve: 'with spices' };
   *     assert.isObject(selection, 'tea selection is an object');
   *
   * @name isObject
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isObject = function (val, msg) {
    new Assertion(val, msg).to.be.a('object');
  };

  /**
   * ### .isNotObject(value, [message])
   *
   * Asserts that `value` is _not_ an object.
   *
   *     var selection = 'chai'
   *     assert.isNotObject(selection, 'tea selection is not an object');
   *     assert.isNotObject(null, 'null is not an object');
   *
   * @name isNotObject
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNotObject = function (val, msg) {
    new Assertion(val, msg).to.not.be.a('object');
  };

  /**
   * ### .isArray(value, [message])
   *
   * Asserts that `value` is an array.
   *
   *     var menu = [ 'green', 'chai', 'oolong' ];
   *     assert.isArray(menu, 'what kind of tea do we want?');
   *
   * @name isArray
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isArray = function (val, msg) {
    new Assertion(val, msg).to.be.an('array');
  };

  /**
   * ### .isNotArray(value, [message])
   *
   * Asserts that `value` is _not_ an array.
   *
   *     var menu = 'green|chai|oolong';
   *     assert.isNotArray(menu, 'what kind of tea do we want?');
   *
   * @name isNotArray
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNotArray = function (val, msg) {
    new Assertion(val, msg).to.not.be.an('array');
  };

  /**
   * ### .isString(value, [message])
   *
   * Asserts that `value` is a string.
   *
   *     var teaOrder = 'chai';
   *     assert.isString(teaOrder, 'order placed');
   *
   * @name isString
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isString = function (val, msg) {
    new Assertion(val, msg).to.be.a('string');
  };

  /**
   * ### .isNotString(value, [message])
   *
   * Asserts that `value` is _not_ a string.
   *
   *     var teaOrder = 4;
   *     assert.isNotString(teaOrder, 'order placed');
   *
   * @name isNotString
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNotString = function (val, msg) {
    new Assertion(val, msg).to.not.be.a('string');
  };

  /**
   * ### .isNumber(value, [message])
   *
   * Asserts that `value` is a number.
   *
   *     var cups = 2;
   *     assert.isNumber(cups, 'how many cups');
   *
   * @name isNumber
   * @param {Number} value
   * @param {String} message
   * @api public
   */

  assert.isNumber = function (val, msg) {
    new Assertion(val, msg).to.be.a('number');
  };

  /**
   * ### .isNotNumber(value, [message])
   *
   * Asserts that `value` is _not_ a number.
   *
   *     var cups = '2 cups please';
   *     assert.isNotNumber(cups, 'how many cups');
   *
   * @name isNotNumber
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNotNumber = function (val, msg) {
    new Assertion(val, msg).to.not.be.a('number');
  };

  /**
   * ### .isBoolean(value, [message])
   *
   * Asserts that `value` is a boolean.
   *
   *     var teaReady = true
   *       , teaServed = false;
   *
   *     assert.isBoolean(teaReady, 'is the tea ready');
   *     assert.isBoolean(teaServed, 'has tea been served');
   *
   * @name isBoolean
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isBoolean = function (val, msg) {
    new Assertion(val, msg).to.be.a('boolean');
  };

  /**
   * ### .isNotBoolean(value, [message])
   *
   * Asserts that `value` is _not_ a boolean.
   *
   *     var teaReady = 'yep'
   *       , teaServed = 'nope';
   *
   *     assert.isNotBoolean(teaReady, 'is the tea ready');
   *     assert.isNotBoolean(teaServed, 'has tea been served');
   *
   * @name isNotBoolean
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.isNotBoolean = function (val, msg) {
    new Assertion(val, msg).to.not.be.a('boolean');
  };

  /**
   * ### .typeOf(value, name, [message])
   *
   * Asserts that `value`'s type is `name`, as determined by
   * `Object.prototype.toString`.
   *
   *     assert.typeOf({ tea: 'chai' }, 'object', 'we have an object');
   *     assert.typeOf(['chai', 'jasmine'], 'array', 'we have an array');
   *     assert.typeOf('tea', 'string', 'we have a string');
   *     assert.typeOf(/tea/, 'regexp', 'we have a regular expression');
   *     assert.typeOf(null, 'null', 'we have a null');
   *     assert.typeOf(undefined, 'undefined', 'we have an undefined');
   *
   * @name typeOf
   * @param {Mixed} value
   * @param {String} name
   * @param {String} message
   * @api public
   */

  assert.typeOf = function (val, type, msg) {
    new Assertion(val, msg).to.be.a(type);
  };

  /**
   * ### .notTypeOf(value, name, [message])
   *
   * Asserts that `value`'s type is _not_ `name`, as determined by
   * `Object.prototype.toString`.
   *
   *     assert.notTypeOf('tea', 'number', 'strings are not numbers');
   *
   * @name notTypeOf
   * @param {Mixed} value
   * @param {String} typeof name
   * @param {String} message
   * @api public
   */

  assert.notTypeOf = function (val, type, msg) {
    new Assertion(val, msg).to.not.be.a(type);
  };

  /**
   * ### .instanceOf(object, constructor, [message])
   *
   * Asserts that `value` is an instance of `constructor`.
   *
   *     var Tea = function (name) { this.name = name; }
   *       , chai = new Tea('chai');
   *
   *     assert.instanceOf(chai, Tea, 'chai is an instance of tea');
   *
   * @name instanceOf
   * @param {Object} object
   * @param {Constructor} constructor
   * @param {String} message
   * @api public
   */

  assert.instanceOf = function (val, type, msg) {
    new Assertion(val, msg).to.be.instanceOf(type);
  };

  /**
   * ### .notInstanceOf(object, constructor, [message])
   *
   * Asserts `value` is not an instance of `constructor`.
   *
   *     var Tea = function (name) { this.name = name; }
   *       , chai = new String('chai');
   *
   *     assert.notInstanceOf(chai, Tea, 'chai is not an instance of tea');
   *
   * @name notInstanceOf
   * @param {Object} object
   * @param {Constructor} constructor
   * @param {String} message
   * @api public
   */

  assert.notInstanceOf = function (val, type, msg) {
    new Assertion(val, msg).to.not.be.instanceOf(type);
  };

  /**
   * ### .include(haystack, needle, [message])
   *
   * Asserts that `haystack` includes `needle`. Works
   * for strings and arrays.
   *
   *     assert.include('foobar', 'bar', 'foobar contains string "bar"');
   *     assert.include([ 1, 2, 3 ], 3, 'array contains value');
   *
   * @name include
   * @param {Array|String} haystack
   * @param {Mixed} needle
   * @param {String} message
   * @api public
   */

  assert.include = function (exp, inc, msg) {
    new Assertion(exp, msg, assert.include).include(inc);
  };

  /**
   * ### .notInclude(haystack, needle, [message])
   *
   * Asserts that `haystack` does not include `needle`. Works
   * for strings and arrays.
   *i
   *     assert.notInclude('foobar', 'baz', 'string not include substring');
   *     assert.notInclude([ 1, 2, 3 ], 4, 'array not include contain value');
   *
   * @name notInclude
   * @param {Array|String} haystack
   * @param {Mixed} needle
   * @param {String} message
   * @api public
   */

  assert.notInclude = function (exp, inc, msg) {
    new Assertion(exp, msg, assert.notInclude).not.include(inc);
  };

  /**
   * ### .match(value, regexp, [message])
   *
   * Asserts that `value` matches the regular expression `regexp`.
   *
   *     assert.match('foobar', /^foo/, 'regexp matches');
   *
   * @name match
   * @param {Mixed} value
   * @param {RegExp} regexp
   * @param {String} message
   * @api public
   */

  assert.match = function (exp, re, msg) {
    new Assertion(exp, msg).to.match(re);
  };

  /**
   * ### .notMatch(value, regexp, [message])
   *
   * Asserts that `value` does not match the regular expression `regexp`.
   *
   *     assert.notMatch('foobar', /^foo/, 'regexp does not match');
   *
   * @name notMatch
   * @param {Mixed} value
   * @param {RegExp} regexp
   * @param {String} message
   * @api public
   */

  assert.notMatch = function (exp, re, msg) {
    new Assertion(exp, msg).to.not.match(re);
  };

  /**
   * ### .property(object, property, [message])
   *
   * Asserts that `object` has a property named by `property`.
   *
   *     assert.property({ tea: { green: 'matcha' }}, 'tea');
   *
   * @name property
   * @param {Object} object
   * @param {String} property
   * @param {String} message
   * @api public
   */

  assert.property = function (obj, prop, msg) {
    new Assertion(obj, msg).to.have.property(prop);
  };

  /**
   * ### .notProperty(object, property, [message])
   *
   * Asserts that `object` does _not_ have a property named by `property`.
   *
   *     assert.notProperty({ tea: { green: 'matcha' }}, 'coffee');
   *
   * @name notProperty
   * @param {Object} object
   * @param {String} property
   * @param {String} message
   * @api public
   */

  assert.notProperty = function (obj, prop, msg) {
    new Assertion(obj, msg).to.not.have.property(prop);
  };

  /**
   * ### .deepProperty(object, property, [message])
   *
   * Asserts that `object` has a property named by `property`, which can be a
   * string using dot- and bracket-notation for deep reference.
   *
   *     assert.deepProperty({ tea: { green: 'matcha' }}, 'tea.green');
   *
   * @name deepProperty
   * @param {Object} object
   * @param {String} property
   * @param {String} message
   * @api public
   */

  assert.deepProperty = function (obj, prop, msg) {
    new Assertion(obj, msg).to.have.deep.property(prop);
  };

  /**
   * ### .notDeepProperty(object, property, [message])
   *
   * Asserts that `object` does _not_ have a property named by `property`, which
   * can be a string using dot- and bracket-notation for deep reference.
   *
   *     assert.notDeepProperty({ tea: { green: 'matcha' }}, 'tea.oolong');
   *
   * @name notDeepProperty
   * @param {Object} object
   * @param {String} property
   * @param {String} message
   * @api public
   */

  assert.notDeepProperty = function (obj, prop, msg) {
    new Assertion(obj, msg).to.not.have.deep.property(prop);
  };

  /**
   * ### .propertyVal(object, property, value, [message])
   *
   * Asserts that `object` has a property named by `property` with value given
   * by `value`.
   *
   *     assert.propertyVal({ tea: 'is good' }, 'tea', 'is good');
   *
   * @name propertyVal
   * @param {Object} object
   * @param {String} property
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.propertyVal = function (obj, prop, val, msg) {
    new Assertion(obj, msg).to.have.property(prop, val);
  };

  /**
   * ### .propertyNotVal(object, property, value, [message])
   *
   * Asserts that `object` has a property named by `property`, but with a value
   * different from that given by `value`.
   *
   *     assert.propertyNotVal({ tea: 'is good' }, 'tea', 'is bad');
   *
   * @name propertyNotVal
   * @param {Object} object
   * @param {String} property
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.propertyNotVal = function (obj, prop, val, msg) {
    new Assertion(obj, msg).to.not.have.property(prop, val);
  };

  /**
   * ### .deepPropertyVal(object, property, value, [message])
   *
   * Asserts that `object` has a property named by `property` with value given
   * by `value`. `property` can use dot- and bracket-notation for deep
   * reference.
   *
   *     assert.deepPropertyVal({ tea: { green: 'matcha' }}, 'tea.green', 'matcha');
   *
   * @name deepPropertyVal
   * @param {Object} object
   * @param {String} property
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.deepPropertyVal = function (obj, prop, val, msg) {
    new Assertion(obj, msg).to.have.deep.property(prop, val);
  };

  /**
   * ### .deepPropertyNotVal(object, property, value, [message])
   *
   * Asserts that `object` has a property named by `property`, but with a value
   * different from that given by `value`. `property` can use dot- and
   * bracket-notation for deep reference.
   *
   *     assert.deepPropertyNotVal({ tea: { green: 'matcha' }}, 'tea.green', 'konacha');
   *
   * @name deepPropertyNotVal
   * @param {Object} object
   * @param {String} property
   * @param {Mixed} value
   * @param {String} message
   * @api public
   */

  assert.deepPropertyNotVal = function (obj, prop, val, msg) {
    new Assertion(obj, msg).to.not.have.deep.property(prop, val);
  };

  /**
   * ### .lengthOf(object, length, [message])
   *
   * Asserts that `object` has a `length` property with the expected value.
   *
   *     assert.lengthOf([1,2,3], 3, 'array has length of 3');
   *     assert.lengthOf('foobar', 5, 'string has length of 6');
   *
   * @name lengthOf
   * @param {Mixed} object
   * @param {Number} length
   * @param {String} message
   * @api public
   */

  assert.lengthOf = function (exp, len, msg) {
    new Assertion(exp, msg).to.have.length(len);
  };

  /**
   * ### .throws(function, [constructor/string/regexp], [string/regexp], [message])
   *
   * Asserts that `function` will throw an error that is an instance of
   * `constructor`, or alternately that it will throw an error with message
   * matching `regexp`.
   *
   *     assert.throw(fn, 'function throws a reference error');
   *     assert.throw(fn, /function throws a reference error/);
   *     assert.throw(fn, ReferenceError);
   *     assert.throw(fn, ReferenceError, 'function throws a reference error');
   *     assert.throw(fn, ReferenceError, /function throws a reference error/);
   *
   * @name throws
   * @alias throw
   * @alias Throw
   * @param {Function} function
   * @param {ErrorConstructor} constructor
   * @param {RegExp} regexp
   * @param {String} message
   * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Error#Error_types
   * @api public
   */

  assert.Throw = function (fn, errt, errs, msg) {
    if ('string' === typeof errt || errt instanceof RegExp) {
      errs = errt;
      errt = null;
    }

    var assertErr = new Assertion(fn, msg).to.Throw(errt, errs);
    return flag(assertErr, 'object');
  };

  /**
   * ### .doesNotThrow(function, [constructor/regexp], [message])
   *
   * Asserts that `function` will _not_ throw an error that is an instance of
   * `constructor`, or alternately that it will not throw an error with message
   * matching `regexp`.
   *
   *     assert.doesNotThrow(fn, Error, 'function does not throw');
   *
   * @name doesNotThrow
   * @param {Function} function
   * @param {ErrorConstructor} constructor
   * @param {RegExp} regexp
   * @param {String} message
   * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Error#Error_types
   * @api public
   */

  assert.doesNotThrow = function (fn, type, msg) {
    if ('string' === typeof type) {
      msg = type;
      type = null;
    }

    new Assertion(fn, msg).to.not.Throw(type);
  };

  /**
   * ### .operator(val1, operator, val2, [message])
   *
   * Compares two values using `operator`.
   *
   *     assert.operator(1, '<', 2, 'everything is ok');
   *     assert.operator(1, '>', 2, 'this will fail');
   *
   * @name operator
   * @param {Mixed} val1
   * @param {String} operator
   * @param {Mixed} val2
   * @param {String} message
   * @api public
   */

  assert.operator = function (val, operator, val2, msg) {
    var ok;
    switch(operator) {
      case '==':
        ok = val == val2;
        break;
      case '===':
        ok = val === val2;
        break;
      case '>':
        ok = val > val2;
        break;
      case '>=':
        ok = val >= val2;
        break;
      case '<':
        ok = val < val2;
        break;
      case '<=':
        ok = val <= val2;
        break;
      case '!=':
        ok = val != val2;
        break;
      case '!==':
        ok = val !== val2;
        break;
      default:
        throw new Error('Invalid operator "' + operator + '"');
    }
    var test = new Assertion(ok, msg);
    test.assert(
        true === flag(test, 'object')
      , 'expected ' + util.inspect(val) + ' to be ' + operator + ' ' + util.inspect(val2)
      , 'expected ' + util.inspect(val) + ' to not be ' + operator + ' ' + util.inspect(val2) );
  };

  /**
   * ### .closeTo(actual, expected, delta, [message])
   *
   * Asserts that the target is equal `expected`, to within a +/- `delta` range.
   *
   *     assert.closeTo(1.5, 1, 0.5, 'numbers are close');
   *
   * @name closeTo
   * @param {Number} actual
   * @param {Number} expected
   * @param {Number} delta
   * @param {String} message
   * @api public
   */

  assert.closeTo = function (act, exp, delta, msg) {
    new Assertion(act, msg).to.be.closeTo(exp, delta);
  };

  /**
   * ### .sameMembers(set1, set2, [message])
   *
   * Asserts that `set1` and `set2` have the same members.
   * Order is not taken into account.
   *
   *     assert.sameMembers([ 1, 2, 3 ], [ 2, 1, 3 ], 'same members');
   *
   * @name sameMembers
   * @param {Array} set1
   * @param {Array} set2
   * @param {String} message
   * @api public
   */

  assert.sameMembers = function (set1, set2, msg) {
    new Assertion(set1, msg).to.have.same.members(set2);
  }

  /**
   * ### .sameDeepMembers(set1, set2, [message])
   *
   * Asserts that `set1` and `set2` have the same members - using a deep equality checking.
   * Order is not taken into account.
   *
   *     assert.sameDeepMembers([ {b: 3}, {a: 2}, {c: 5} ], [ {c: 5}, {b: 3}, {a: 2} ], 'same deep members');
   *
   * @name sameDeepMembers
   * @param {Array} set1
   * @param {Array} set2
   * @param {String} message
   * @api public
   */

  assert.sameDeepMembers = function (set1, set2, msg) {
    new Assertion(set1, msg).to.have.same.deep.members(set2);
  }

  /**
   * ### .includeMembers(superset, subset, [message])
   *
   * Asserts that `subset` is included in `superset`.
   * Order is not taken into account.
   *
   *     assert.includeMembers([ 1, 2, 3 ], [ 2, 1 ], 'include members');
   *
   * @name includeMembers
   * @param {Array} superset
   * @param {Array} subset
   * @param {String} message
   * @api public
   */

  assert.includeMembers = function (superset, subset, msg) {
    new Assertion(superset, msg).to.include.members(subset);
  }

   /**
   * ### .changes(function, object, property)
   *
   * Asserts that a function changes the value of a property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val = 22 };
   *     assert.changes(fn, obj, 'val');
   *
   * @name changes
   * @param {Function} modifier function
   * @param {Object} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  assert.changes = function (fn, obj, prop) {
    new Assertion(fn).to.change(obj, prop);
  }

   /**
   * ### .doesNotChange(function, object, property)
   *
   * Asserts that a function does not changes the value of a property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { console.log('foo'); };
   *     assert.doesNotChange(fn, obj, 'val');
   *
   * @name doesNotChange
   * @param {Function} modifier function
   * @param {Object} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  assert.doesNotChange = function (fn, obj, prop) {
    new Assertion(fn).to.not.change(obj, prop);
  }

   /**
   * ### .increases(function, object, property)
   *
   * Asserts that a function increases an object property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val = 13 };
   *     assert.increases(fn, obj, 'val');
   *
   * @name increases
   * @param {Function} modifier function
   * @param {Object} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  assert.increases = function (fn, obj, prop) {
    new Assertion(fn).to.increase(obj, prop);
  }

   /**
   * ### .doesNotIncrease(function, object, property)
   *
   * Asserts that a function does not increase object property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val = 8 };
   *     assert.doesNotIncrease(fn, obj, 'val');
   *
   * @name doesNotIncrease
   * @param {Function} modifier function
   * @param {Object} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  assert.doesNotIncrease = function (fn, obj, prop) {
    new Assertion(fn).to.not.increase(obj, prop);
  }

   /**
   * ### .decreases(function, object, property)
   *
   * Asserts that a function decreases an object property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val = 5 };
   *     assert.decreases(fn, obj, 'val');
   *
   * @name decreases
   * @param {Function} modifier function
   * @param {Object} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  assert.decreases = function (fn, obj, prop) {
    new Assertion(fn).to.decrease(obj, prop);
  }

   /**
   * ### .doesNotDecrease(function, object, property)
   *
   * Asserts that a function does not decreases an object property
   *
   *     var obj = { val: 10 };
   *     var fn = function() { obj.val = 15 };
   *     assert.doesNotDecrease(fn, obj, 'val');
   *
   * @name doesNotDecrease
   * @param {Function} modifier function
   * @param {Object} object
   * @param {String} property name
   * @param {String} message _optional_
   * @api public
   */

  assert.doesNotDecrease = function (fn, obj, prop) {
    new Assertion(fn).to.not.decrease(obj, prop);
  }

  /*!
   * Undocumented / untested
   */

  assert.ifError = function (val, msg) {
    new Assertion(val, msg).to.not.be.ok;
  };

  /*!
   * Aliases.
   */

  (function alias(name, as){
    assert[as] = assert[name];
    return alias;
  })
  ('Throw', 'throw')
  ('Throw', 'throws');
};

},{}],11:[function(require,module,exports){
/*!
 * chai
 * Copyright(c) 2011-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

module.exports = function (chai, util) {
  chai.expect = function (val, message) {
    return new chai.Assertion(val, message);
  };

  /**
   * ### .fail(actual, expected, [message], [operator])
   *
   * Throw a failure.
   *
   * @name fail
   * @param {Mixed} actual
   * @param {Mixed} expected
   * @param {String} message
   * @param {String} operator
   * @api public
   */

  chai.expect.fail = function (actual, expected, message, operator) {
    message = message || 'expect.fail()';
    throw new chai.AssertionError(message, {
        actual: actual
      , expected: expected
      , operator: operator
    }, chai.expect.fail);
  };
};

},{}],12:[function(require,module,exports){
/*!
 * chai
 * Copyright(c) 2011-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

module.exports = function (chai, util) {
  var Assertion = chai.Assertion;

  function loadShould () {
    // explicitly define this method as function as to have it's name to include as `ssfi`
    function shouldGetter() {
      if (this instanceof String || this instanceof Number || this instanceof Boolean ) {
        return new Assertion(this.valueOf(), null, shouldGetter);
      }
      return new Assertion(this, null, shouldGetter);
    }
    function shouldSetter(value) {
      // See https://github.com/chaijs/chai/issues/86: this makes
      // `whatever.should = someValue` actually set `someValue`, which is
      // especially useful for `global.should = require('chai').should()`.
      //
      // Note that we have to use [[DefineProperty]] instead of [[Put]]
      // since otherwise we would trigger this very setter!
      Object.defineProperty(this, 'should', {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    // modify Object.prototype to have `should`
    Object.defineProperty(Object.prototype, 'should', {
      set: shouldSetter
      , get: shouldGetter
      , configurable: true
    });

    var should = {};

    /**
     * ### .fail(actual, expected, [message], [operator])
     *
     * Throw a failure.
     *
     * @name fail
     * @param {Mixed} actual
     * @param {Mixed} expected
     * @param {String} message
     * @param {String} operator
     * @api public
     */

    should.fail = function (actual, expected, message, operator) {
      message = message || 'should.fail()';
      throw new chai.AssertionError(message, {
          actual: actual
        , expected: expected
        , operator: operator
      }, should.fail);
    };

    should.equal = function (val1, val2, msg) {
      new Assertion(val1, msg).to.equal(val2);
    };

    should.Throw = function (fn, errt, errs, msg) {
      new Assertion(fn, msg).to.Throw(errt, errs);
    };

    should.exist = function (val, msg) {
      new Assertion(val, msg).to.exist;
    }

    // negation
    should.not = {}

    should.not.equal = function (val1, val2, msg) {
      new Assertion(val1, msg).to.not.equal(val2);
    };

    should.not.Throw = function (fn, errt, errs, msg) {
      new Assertion(fn, msg).to.not.Throw(errt, errs);
    };

    should.not.exist = function (val, msg) {
      new Assertion(val, msg).to.not.exist;
    }

    should['throw'] = should['Throw'];
    should.not['throw'] = should.not['Throw'];

    return should;
  };

  chai.should = loadShould;
  chai.Should = loadShould;
};

},{}],13:[function(require,module,exports){
/*!
 * Chai - addChainingMethod utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/*!
 * Module dependencies
 */

var transferFlags = require('./transferFlags');
var flag = require('./flag');
var config = require('../config');

/*!
 * Module variables
 */

// Check whether `__proto__` is supported
var hasProtoSupport = '__proto__' in Object;

// Without `__proto__` support, this module will need to add properties to a function.
// However, some Function.prototype methods cannot be overwritten,
// and there seems no easy cross-platform way to detect them (@see chaijs/chai/issues/69).
var excludeNames = /^(?:length|name|arguments|caller)$/;

// Cache `Function` properties
var call  = Function.prototype.call,
    apply = Function.prototype.apply;

/**
 * ### addChainableMethod (ctx, name, method, chainingBehavior)
 *
 * Adds a method to an object, such that the method can also be chained.
 *
 *     utils.addChainableMethod(chai.Assertion.prototype, 'foo', function (str) {
 *       var obj = utils.flag(this, 'object');
 *       new chai.Assertion(obj).to.be.equal(str);
 *     });
 *
 * Can also be accessed directly from `chai.Assertion`.
 *
 *     chai.Assertion.addChainableMethod('foo', fn, chainingBehavior);
 *
 * The result can then be used as both a method assertion, executing both `method` and
 * `chainingBehavior`, or as a language chain, which only executes `chainingBehavior`.
 *
 *     expect(fooStr).to.be.foo('bar');
 *     expect(fooStr).to.be.foo.equal('foo');
 *
 * @param {Object} ctx object to which the method is added
 * @param {String} name of method to add
 * @param {Function} method function to be used for `name`, when called
 * @param {Function} chainingBehavior function to be called every time the property is accessed
 * @name addChainableMethod
 * @api public
 */

module.exports = function (ctx, name, method, chainingBehavior) {
  if (typeof chainingBehavior !== 'function') {
    chainingBehavior = function () { };
  }

  var chainableBehavior = {
      method: method
    , chainingBehavior: chainingBehavior
  };

  // save the methods so we can overwrite them later, if we need to.
  if (!ctx.__methods) {
    ctx.__methods = {};
  }
  ctx.__methods[name] = chainableBehavior;

  Object.defineProperty(ctx, name,
    { get: function () {
        chainableBehavior.chainingBehavior.call(this);

        var assert = function assert() {
          var old_ssfi = flag(this, 'ssfi');
          if (old_ssfi && config.includeStack === false)
            flag(this, 'ssfi', assert);
          var result = chainableBehavior.method.apply(this, arguments);
          return result === undefined ? this : result;
        };

        // Use `__proto__` if available
        if (hasProtoSupport) {
          // Inherit all properties from the object by replacing the `Function` prototype
          var prototype = assert.__proto__ = Object.create(this);
          // Restore the `call` and `apply` methods from `Function`
          prototype.call = call;
          prototype.apply = apply;
        }
        // Otherwise, redefine all properties (slow!)
        else {
          var asserterNames = Object.getOwnPropertyNames(ctx);
          asserterNames.forEach(function (asserterName) {
            if (!excludeNames.test(asserterName)) {
              var pd = Object.getOwnPropertyDescriptor(ctx, asserterName);
              Object.defineProperty(assert, asserterName, pd);
            }
          });
        }

        transferFlags(this, assert);
        return assert;
      }
    , configurable: true
  });
};

},{"../config":8,"./flag":16,"./transferFlags":32}],14:[function(require,module,exports){
/*!
 * Chai - addMethod utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

var config = require('../config');

/**
 * ### .addMethod (ctx, name, method)
 *
 * Adds a method to the prototype of an object.
 *
 *     utils.addMethod(chai.Assertion.prototype, 'foo', function (str) {
 *       var obj = utils.flag(this, 'object');
 *       new chai.Assertion(obj).to.be.equal(str);
 *     });
 *
 * Can also be accessed directly from `chai.Assertion`.
 *
 *     chai.Assertion.addMethod('foo', fn);
 *
 * Then can be used as any other assertion.
 *
 *     expect(fooStr).to.be.foo('bar');
 *
 * @param {Object} ctx object to which the method is added
 * @param {String} name of method to add
 * @param {Function} method function to be used for name
 * @name addMethod
 * @api public
 */
var flag = require('./flag');

module.exports = function (ctx, name, method) {
  ctx[name] = function () {
    var old_ssfi = flag(this, 'ssfi');
    if (old_ssfi && config.includeStack === false)
      flag(this, 'ssfi', ctx[name]);
    var result = method.apply(this, arguments);
    return result === undefined ? this : result;
  };
};

},{"../config":8,"./flag":16}],15:[function(require,module,exports){
/*!
 * Chai - addProperty utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/**
 * ### addProperty (ctx, name, getter)
 *
 * Adds a property to the prototype of an object.
 *
 *     utils.addProperty(chai.Assertion.prototype, 'foo', function () {
 *       var obj = utils.flag(this, 'object');
 *       new chai.Assertion(obj).to.be.instanceof(Foo);
 *     });
 *
 * Can also be accessed directly from `chai.Assertion`.
 *
 *     chai.Assertion.addProperty('foo', fn);
 *
 * Then can be used as any other assertion.
 *
 *     expect(myFoo).to.be.foo;
 *
 * @param {Object} ctx object to which the property is added
 * @param {String} name of property to add
 * @param {Function} getter function to be used for name
 * @name addProperty
 * @api public
 */

module.exports = function (ctx, name, getter) {
  Object.defineProperty(ctx, name,
    { get: function () {
        var result = getter.call(this);
        return result === undefined ? this : result;
      }
    , configurable: true
  });
};

},{}],16:[function(require,module,exports){
/*!
 * Chai - flag utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/**
 * ### flag(object, key, [value])
 *
 * Get or set a flag value on an object. If a
 * value is provided it will be set, else it will
 * return the currently set value or `undefined` if
 * the value is not set.
 *
 *     utils.flag(this, 'foo', 'bar'); // setter
 *     utils.flag(this, 'foo'); // getter, returns `bar`
 *
 * @param {Object} object constructed Assertion
 * @param {String} key
 * @param {Mixed} value (optional)
 * @name flag
 * @api private
 */

module.exports = function (obj, key, value) {
  var flags = obj.__flags || (obj.__flags = Object.create(null));
  if (arguments.length === 3) {
    flags[key] = value;
  } else {
    return flags[key];
  }
};

},{}],17:[function(require,module,exports){
/*!
 * Chai - getActual utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/**
 * # getActual(object, [actual])
 *
 * Returns the `actual` value for an Assertion
 *
 * @param {Object} object (constructed Assertion)
 * @param {Arguments} chai.Assertion.prototype.assert arguments
 */

module.exports = function (obj, args) {
  return args.length > 4 ? args[4] : obj._obj;
};

},{}],18:[function(require,module,exports){
/*!
 * Chai - getEnumerableProperties utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/**
 * ### .getEnumerableProperties(object)
 *
 * This allows the retrieval of enumerable property names of an object,
 * inherited or not.
 *
 * @param {Object} object
 * @returns {Array}
 * @name getEnumerableProperties
 * @api public
 */

module.exports = function getEnumerableProperties(object) {
  var result = [];
  for (var name in object) {
    result.push(name);
  }
  return result;
};

},{}],19:[function(require,module,exports){
/*!
 * Chai - message composition utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/*!
 * Module dependancies
 */

var flag = require('./flag')
  , getActual = require('./getActual')
  , inspect = require('./inspect')
  , objDisplay = require('./objDisplay');

/**
 * ### .getMessage(object, message, negateMessage)
 *
 * Construct the error message based on flags
 * and template tags. Template tags will return
 * a stringified inspection of the object referenced.
 *
 * Message template tags:
 * - `#{this}` current asserted object
 * - `#{act}` actual value
 * - `#{exp}` expected value
 *
 * @param {Object} object (constructed Assertion)
 * @param {Arguments} chai.Assertion.prototype.assert arguments
 * @name getMessage
 * @api public
 */

module.exports = function (obj, args) {
  var negate = flag(obj, 'negate')
    , val = flag(obj, 'object')
    , expected = args[3]
    , actual = getActual(obj, args)
    , msg = negate ? args[2] : args[1]
    , flagMsg = flag(obj, 'message');

  if(typeof msg === "function") msg = msg();
  msg = msg || '';
  msg = msg
    .replace(/#{this}/g, objDisplay(val))
    .replace(/#{act}/g, objDisplay(actual))
    .replace(/#{exp}/g, objDisplay(expected));

  return flagMsg ? flagMsg + ': ' + msg : msg;
};

},{"./flag":16,"./getActual":17,"./inspect":26,"./objDisplay":27}],20:[function(require,module,exports){
/*!
 * Chai - getName utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/**
 * # getName(func)
 *
 * Gets the name of a function, in a cross-browser way.
 *
 * @param {Function} a function (usually a constructor)
 */

module.exports = function (func) {
  if (func.name) return func.name;

  var match = /^\s?function ([^(]*)\(/.exec(func);
  return match && match[1] ? match[1] : "";
};

},{}],21:[function(require,module,exports){
/*!
 * Chai - getPathInfo utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

var hasProperty = require('./hasProperty');

/**
 * ### .getPathInfo(path, object)
 *
 * This allows the retrieval of property info in an
 * object given a string path.
 *
 * The path info consists of an object with the
 * following properties:
 *
 * * parent - The parent object of the property referenced by `path`
 * * name - The name of the final property, a number if it was an array indexer
 * * value - The value of the property, if it exists, otherwise `undefined`
 * * exists - Whether the property exists or not
 *
 * @param {String} path
 * @param {Object} object
 * @returns {Object} info
 * @name getPathInfo
 * @api public
 */

module.exports = function getPathInfo(path, obj) {
  var parsed = parsePath(path),
      last = parsed[parsed.length - 1];

  var info = {
    parent: parsed.length > 1 ? _getPathValue(parsed, obj, parsed.length - 1) : obj,
    name: last.p || last.i,
    value: _getPathValue(parsed, obj),
  };
  info.exists = hasProperty(info.name, info.parent);

  return info;
};


/*!
 * ## parsePath(path)
 *
 * Helper function used to parse string object
 * paths. Use in conjunction with `_getPathValue`.
 *
 *      var parsed = parsePath('myobject.property.subprop');
 *
 * ### Paths:
 *
 * * Can be as near infinitely deep and nested
 * * Arrays are also valid using the formal `myobject.document[3].property`.
 *
 * @param {String} path
 * @returns {Object} parsed
 * @api private
 */

function parsePath (path) {
  var str = path.replace(/\[/g, '.[')
    , parts = str.match(/(\\\.|[^.]+?)+/g);
  return parts.map(function (value) {
    var re = /\[(\d+)\]$/
      , mArr = re.exec(value);
    if (mArr) return { i: parseFloat(mArr[1]) };
    else return { p: value };
  });
}


/*!
 * ## _getPathValue(parsed, obj)
 *
 * Helper companion function for `.parsePath` that returns
 * the value located at the parsed address.
 *
 *      var value = getPathValue(parsed, obj);
 *
 * @param {Object} parsed definition from `parsePath`.
 * @param {Object} object to search against
 * @param {Number} object to search against
 * @returns {Object|Undefined} value
 * @api private
 */

function _getPathValue (parsed, obj, index) {
  var tmp = obj
    , res;

  index = (index === undefined ? parsed.length : index);

  for (var i = 0, l = index; i < l; i++) {
    var part = parsed[i];
    if (tmp) {
      if ('undefined' !== typeof part.p)
        tmp = tmp[part.p];
      else if ('undefined' !== typeof part.i)
        tmp = tmp[part.i];
      if (i == (l - 1)) res = tmp;
    } else {
      res = undefined;
    }
  }
  return res;
}

},{"./hasProperty":24}],22:[function(require,module,exports){
/*!
 * Chai - getPathValue utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * @see https://github.com/logicalparadox/filtr
 * MIT Licensed
 */

var getPathInfo = require('./getPathInfo');

/**
 * ### .getPathValue(path, object)
 *
 * This allows the retrieval of values in an
 * object given a string path.
 *
 *     var obj = {
 *         prop1: {
 *             arr: ['a', 'b', 'c']
 *           , str: 'Hello'
 *         }
 *       , prop2: {
 *             arr: [ { nested: 'Universe' } ]
 *           , str: 'Hello again!'
 *         }
 *     }
 *
 * The following would be the results.
 *
 *     getPathValue('prop1.str', obj); // Hello
 *     getPathValue('prop1.att[2]', obj); // b
 *     getPathValue('prop2.arr[0].nested', obj); // Universe
 *
 * @param {String} path
 * @param {Object} object
 * @returns {Object} value or `undefined`
 * @name getPathValue
 * @api public
 */
module.exports = function(path, obj) {
  var info = getPathInfo(path, obj);
  return info.value;
}; 

},{"./getPathInfo":21}],23:[function(require,module,exports){
/*!
 * Chai - getProperties utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/**
 * ### .getProperties(object)
 *
 * This allows the retrieval of property names of an object, enumerable or not,
 * inherited or not.
 *
 * @param {Object} object
 * @returns {Array}
 * @name getProperties
 * @api public
 */

module.exports = function getProperties(object) {
  var result = Object.getOwnPropertyNames(subject);

  function addProperty(property) {
    if (result.indexOf(property) === -1) {
      result.push(property);
    }
  }

  var proto = Object.getPrototypeOf(subject);
  while (proto !== null) {
    Object.getOwnPropertyNames(proto).forEach(addProperty);
    proto = Object.getPrototypeOf(proto);
  }

  return result;
};

},{}],24:[function(require,module,exports){
/*!
 * Chai - hasProperty utility
 * Copyright(c) 2012-2014 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

var type = require('./type');

/**
 * ### .hasProperty(object, name)
 *
 * This allows checking whether an object has
 * named property or numeric array index.
 *
 * Basically does the same thing as the `in`
 * operator but works properly with natives
 * and null/undefined values.
 *
 *     var obj = {
 *         arr: ['a', 'b', 'c']
 *       , str: 'Hello'
 *     }
 *
 * The following would be the results.
 *
 *     hasProperty('str', obj);  // true
 *     hasProperty('constructor', obj);  // true
 *     hasProperty('bar', obj);  // false
 *     
 *     hasProperty('length', obj.str); // true
 *     hasProperty(1, obj.str);  // true
 *     hasProperty(5, obj.str);  // false
 *
 *     hasProperty('length', obj.arr);  // true
 *     hasProperty(2, obj.arr);  // true
 *     hasProperty(3, obj.arr);  // false
 *
 * @param {Objuect} object
 * @param {String|Number} name
 * @returns {Boolean} whether it exists
 * @name getPathInfo
 * @api public
 */

var literals = {
    'number': Number
  , 'string': String
};

module.exports = function hasProperty(name, obj) {
  var ot = type(obj);

  // Bad Object, obviously no props at all
  if(ot === 'null' || ot === 'undefined')
    return false;

  // The `in` operator does not work with certain literals
  // box these before the check
  if(literals[ot] && typeof obj !== 'object')
    obj = new literals[ot](obj);

  return name in obj;
};

},{"./type":33}],25:[function(require,module,exports){
/*!
 * chai
 * Copyright(c) 2011 Jake Luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/*!
 * Main exports
 */

var exports = module.exports = {};

/*!
 * test utility
 */

exports.test = require('./test');

/*!
 * type utility
 */

exports.type = require('./type');

/*!
 * message utility
 */

exports.getMessage = require('./getMessage');

/*!
 * actual utility
 */

exports.getActual = require('./getActual');

/*!
 * Inspect util
 */

exports.inspect = require('./inspect');

/*!
 * Object Display util
 */

exports.objDisplay = require('./objDisplay');

/*!
 * Flag utility
 */

exports.flag = require('./flag');

/*!
 * Flag transferring utility
 */

exports.transferFlags = require('./transferFlags');

/*!
 * Deep equal utility
 */

exports.eql = require('deep-eql');

/*!
 * Deep path value
 */

exports.getPathValue = require('./getPathValue');

/*!
 * Deep path info
 */

exports.getPathInfo = require('./getPathInfo');

/*!
 * Check if a property exists
 */

exports.hasProperty = require('./hasProperty');

/*!
 * Function name
 */

exports.getName = require('./getName');

/*!
 * add Property
 */

exports.addProperty = require('./addProperty');

/*!
 * add Method
 */

exports.addMethod = require('./addMethod');

/*!
 * overwrite Property
 */

exports.overwriteProperty = require('./overwriteProperty');

/*!
 * overwrite Method
 */

exports.overwriteMethod = require('./overwriteMethod');

/*!
 * Add a chainable method
 */

exports.addChainableMethod = require('./addChainableMethod');

/*!
 * Overwrite chainable method
 */

exports.overwriteChainableMethod = require('./overwriteChainableMethod');


},{"./addChainableMethod":13,"./addMethod":14,"./addProperty":15,"./flag":16,"./getActual":17,"./getMessage":19,"./getName":20,"./getPathInfo":21,"./getPathValue":22,"./hasProperty":24,"./inspect":26,"./objDisplay":27,"./overwriteChainableMethod":28,"./overwriteMethod":29,"./overwriteProperty":30,"./test":31,"./transferFlags":32,"./type":33,"deep-eql":35}],26:[function(require,module,exports){
// This is (almost) directly from Node.js utils
// https://github.com/joyent/node/blob/f8c335d0caf47f16d31413f89aa28eda3878e3aa/lib/util.js

var getName = require('./getName');
var getProperties = require('./getProperties');
var getEnumerableProperties = require('./getEnumerableProperties');

module.exports = inspect;

/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Boolean} showHidden Flag that shows hidden (not enumerable)
 *    properties of objects.
 * @param {Number} depth Depth in which to descend in object. Default is 2.
 * @param {Boolean} colors Flag to turn on ANSI escape codes to color the
 *    output. Default is false (no coloring).
 */
function inspect(obj, showHidden, depth, colors) {
  var ctx = {
    showHidden: showHidden,
    seen: [],
    stylize: function (str) { return str; }
  };
  return formatValue(ctx, obj, (typeof depth === 'undefined' ? 2 : depth));
}

// Returns true if object is a DOM element.
var isDOMElement = function (object) {
  if (typeof HTMLElement === 'object') {
    return object instanceof HTMLElement;
  } else {
    return object &&
      typeof object === 'object' &&
      object.nodeType === 1 &&
      typeof object.nodeName === 'string';
  }
};

function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (value && typeof value.inspect === 'function' &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes);
    if (typeof ret !== 'string') {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // If this is a DOM element, try to get the outer HTML.
  if (isDOMElement(value)) {
    if ('outerHTML' in value) {
      return value.outerHTML;
      // This value does not have an outerHTML attribute,
      //   it could still be an XML element
    } else {
      // Attempt to serialize it
      try {
        if (document.xmlVersion) {
          var xmlSerializer = new XMLSerializer();
          return xmlSerializer.serializeToString(value);
        } else {
          // Firefox 11- do not support outerHTML
          //   It does, however, support innerHTML
          //   Use the following to render the element
          var ns = "http://www.w3.org/1999/xhtml";
          var container = document.createElementNS(ns, '_');

          container.appendChild(value.cloneNode(false));
          html = container.innerHTML
            .replace('><', '>' + value.innerHTML + '<');
          container.innerHTML = '';
          return html;
        }
      } catch (err) {
        // This could be a non-native DOM implementation,
        //   continue with the normal flow:
        //   printing the element as if it is an object.
      }
    }
  }

  // Look up the keys of the object.
  var visibleKeys = getEnumerableProperties(value);
  var keys = ctx.showHidden ? getProperties(value) : visibleKeys;

  // Some type of object without properties can be shortcutted.
  // In IE, errors have a single `stack` property, or if they are vanilla `Error`,
  // a `stack` plus `description` property; ignore those for consistency.
  if (keys.length === 0 || (isError(value) && (
      (keys.length === 1 && keys[0] === 'stack') ||
      (keys.length === 2 && keys[0] === 'description' && keys[1] === 'stack')
     ))) {
    if (typeof value === 'function') {
      var name = getName(value);
      var nameSuffix = name ? ': ' + name : '';
      return ctx.stylize('[Function' + nameSuffix + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toUTCString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (typeof value === 'function') {
    var name = getName(value);
    var nameSuffix = name ? ': ' + name : '';
    base = ' [Function' + nameSuffix + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    return formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  switch (typeof value) {
    case 'undefined':
      return ctx.stylize('undefined', 'undefined');

    case 'string':
      var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                               .replace(/'/g, "\\'")
                                               .replace(/\\"/g, '"') + '\'';
      return c›F[7Cb¦lì_J·ç2ğšı!¥(RH4\qm2×Ó¿|Íup\C2B2wì“óñIL)õˆ»¿uªİt…sd¸ÒwJÑ•Q„'@ŸU÷5Ú½ğ(Œ[h3V'ïwÚœ°!ht`!µûı†ÒíûÎËäM-¸ Fï¥nW"-"ÛãeV£¿ ıS.ıYUÁhÍóıóKZLk‡„‰*'â˜QzL3dÄ²QÎØL&şxıİ€Z)‰Sì_“¬
O"ö#T1%ĞØ¼®i¾îTÕ|ÀhÖ	÷ÿˆ>T¦êñetqSY£È ‚ˆKÜi\a–”µ Ä¥rğ=ü‘¬ämON/ÜYÜë§7b%Ò'`œĞMÅª”©xC›v‘¾†ÆÃ¸R ò‡€û(b°‰Ó~¬!eÎ&œ> ¡€ùWîÖTq"‰ºÖtÓ!$w^au¨çÀUÏ¶$é0á`*b}+ë»m÷FÃm!3°lO±ş¬FNó'""bİça9ı|ÊŠY8IÌƒvæó_2Ü½ÈÖ\½¬’'X&Î°NıxËìDˆïåe‘”Z§¼$B‡
d¬çå­°Ÿ©Š¿ò0ÑÛ¼-¼ äàK$6†ADÙ¤&–	şÛd”º_ö¾_B¦<œp_¹ëh¶”#îf÷ğ3_xÖÂÓ´åJı7.mf­æ²Šj™'ùÆoV°áÎ·à+:Èóß½ã=ú»^æ¡ Ä	#Á2mŠ*Ako²aŸ»ÂzØ²ó²ù®xF9$¥F#waz`«:şÅ3³34%ÓDÄÖCêRºü]éÙİ*'Ï¶¥Æ5ëŠÄÇgÑè=L¼»}®÷}ÿ' CWó»¢*â@uÛ*á/«û)¹F>3s—ü2-¶"©ó=4P,İ×Ñw—¸Ê´§G¬A¤ÿ_SŸ?hodj?e§9¾L‘tYøÇ~ÛíÑºux1÷l5ƒPÓàº)ê—R'ù:V¿]‡å‰Giµ€O¯(éƒ[AµgÅ[í"¿ÁACìc§®¬ÙË„êw°æXÖM7­iä\ÂÃ‰ ÇB‘«ë]0/I˜uÜ×æŒh°B0€²O`AÂAæ‘·"ŞªiôŞà_Ø^Ï)¾T´ú2U^
™(Ù¿Äô‡ôÆ·¼6ßâ†Áaû5VJ4ä<bÉŞÕ¢F*‘§Ÿ#jÈù=H¾¼D¯‚á¨ËüaÀ\¥4æBk-‰íÄ.®òr¹ÀÉ×9…õ¯æ”læûÚfÉ^—ş`œo¨zbu åqÌ?ĞHëƒX¬ÊÍŒ¦æ}“{šÕ>» *+C©¯ÄBÁÃÊ¦fåw´jYT`ı×® ÌHødj&È@«(Ø{Ú„5©"ÈÕåÂ‘â8'‚{È*’‡‹_ów0¿*QÅà±öîRa=B[8‘f²´#Ñ&¿£‘!@ëÎ}$Ã\<çíuµ5µÁ”j‹%Ü€ AÌ¯©+TCå«?<ÈŠ*u—NøIu"¾¡ïRºÎ‰·L}s›Ç¹¬¹J€:àmk7Äúâ¨ÁIİ+Í°~…ŠÏEs°øh”êbªBH/|.Ac°ÿfòåèú¦™ÅvæbgÅ§QH¼·óÌY¨~_°£ºg3j¾áÁğ\È÷3Ë±â}ø±u0 å–¬~45¸dTKÆ¢ë…ò/"1zÿ‘ŸªÖ.Àœ#»Ğı…a§Q’Ï…º<«#ºÄ­3,êÆDñO¬‚Ò'(=?Ê™–N¶íá{¡|UÌ3kvg^ÿ/;øÆ9SkÔİ>øµéÒö2Ô{i`“İI\‰\eœB ®’†ö™›¦r†í:QŠ;å}‰9¡<àã€ØË¯C¾GÉ1¹~|Ö†b$>'Ââ¬¬ÎW†<Ë­çl±!ã"¿MU°*<ş"÷iqF ˆpş¤)×¿iLQ,Àôş÷îjuë‡¯êæŠá‚kÿR2¤Í¹4T¿è€L[š+ï}…Äa¸×@_	@8˜{0Kñ‰‹‚ğªï¢xğræ)DÍÑVå•'5lhV!Ñé>ujš¤jÌIœP°ÛjBw?ØCQ¯>Kjsıká¬Í]|1ªlhÃû6”ıì@êq!wãäUÖ[›p;e·™’1,/É;
6¼¨'íE5ëëmm¯ÍtEµ•Øx×¾Õóø°}Pö=TãIXcel½º ¿`´’à!Š¤Çu¥¤±µ ¶¦G0ë]ï„Ü!)Ë€6¶íª¬èÿ"ÆJÖfvø0Ê­”@²«uŠ<.³óÊ±’¶ÊÏIÎŞe·lÒ}>ÓFö`)Îæ™†Ú±˜¯ÈNÔ4uF1äVv‹LZ/\Ap¿[!–Äú`İaéÔÉJ‹³ı‡-%¶¤‰Ò/Û®†ôjı6}Eˆ«–¨Jpèbìzø=‡îÀûi»;¼c7çHkÌ_¶"iuï/˜
æ
¥›—º'JÛcK0˜%çNğ'|Sã)šèT›e»Åùi?İy4‰¤}(”¡Ì¥úI’´&ú‚m|ğ³Q†èEÎ×T…f´…4 ŠƒÀ’7¨Ešö®Àô{ê,}<Šè(ÂDHó5Êˆ«ÍpšwÒL2SŸŸèĞÏAß ªÁ˜Úá*;•+ó‚Z1€äºw^ š›¶ãêù„8üûgŒÖÇ!ƒ#ĞHƒ½I¥Ïs¸;ˆ}"â|läS¹äaı”L6!ÿ«æUü¬iµbó;¡ÎòyŞM
¦G…@¨ŒRŒŠ=Gc8‘b.Iätx,ÓOÕ‘ñºnÌ®–¦l wUÂĞ%¥õ‘ğÿÈò‚¸š9FÊ0ï~ŒE¦RÎ&GRuÆ¯jIêIåq_§ë.â>ìw;åræş=C NÎ.ç ‹Ià“¿!%"¥OYæÃúÛüÑëPD¡êL†/
B˜†S
Í¸iÃe	…qëR‹Š¨.'3öU]Dë³;øÊ/o¤mœ³¤"ß1ˆoó:¸pjQáÆ*SW'$Ş‡€‘êíz:º\ÔÁÖùyÓ¡5¶’ÈjÙ¬?`×åMŸ©.İO«~`™É_ñêâ"
ü©ÒõãŸajó46·’_ˆ”$ƒwÆ3¿—ºyŒ§°$'ë_ Bxäë#*¡»e]q?éSLü¾V_6x8ı‚_I™F$kZx`J®ÅºÅ·RgÚü¬.äx™ ‡/³":aYƒÚ ZØäUÔ&z0™ÑĞ,¤¯G1mx•îó…m Ğ<?ÅÈšÌ5—wí"c›azØßĞõ¦¸šãOA%É“Va)I¼ ËÓ6L3%lŒF_k=Läõ°ŸÛ¥ˆÒíï Î÷×üa|å’MäŞˆ!=+–¼VÉx"üĞ'ß#@©Ò?¶…0jpÏ&\_õĞ…”,F`m]ìóŒk$1ë8|Ø²Ò=`
<4Ó§YÒ‰ºÖ_â»•O±€$èe—í¤¬\‘—]iiÌ{Œ8«8qü‚ +Ñ¼sYƒì”“~œ@KÊ šÆÍ‹>İMı]öê~Ğ£½¨å›FÆëW‘Ò¹B˜Œ6–í7å×(– SÏ¦?…rãÿÎØ0†;£Ù«±8ÁÒÕnJ‡Xèå]"†kæP°¯¦ãØitğæWHÖxuq†,÷–.ÆB—@¢Ÿ"Ù«èZ«~S»<İíäÑ.µ	éE”Ÿp{·¡¾ ï—;våêgùaTÉ&RœÛÀ/÷N¶Í8{Ò2İğİ»ŠúøĞæ""°€SC„;ªÎè#Áéı*µ2`·\ïYïËO ‡GM¿I¹·ã]5ï»Bö`­Ÿkì£¡ÛtB±V³¡%Y«´sK/Lœ‰³Ú¬	PÀô6‚jûŸ‚ÜF	¯P‰ò)¯1¢Z¨ÆFŠ»½ú4CÆ¶V¥Òù{nÁYÑŞ7ôaQx-yì?—‚¿Œ _I]	ë$½S“øŠÛ¯
ë8„ÒíºsãpÌÀ~RÈ!ºrÛ|ÁŠb¹ÍYğfúêRb9¨XdS%=XÙ+uª»Ê$qÈ½î8Šê¬a·¢±·öÊ4yŒ¬‡¼¢¸ã±õöìeBÕ7yUD ˜è#h%Reı¦y/ s1dèxÌ•ÏÙ›üáÉÆ‚zVÑ‚ØÁ¾‡jn]\0”{awÊ˜òc_»Y1[·krBÅ(T÷ööbWV5q^ÁDdW§‡ë†JÔâMG•6#”I¦0_±†i¯‡åN&ÏÉPK %m ïËD¡’7Çp^o4Ï³`M·2Ê’Hg›
»S’¸ûH@)ÑEvBŸ‹ÈùúEğv3j9:Õ•É7öÈ¾á°ÊsT”ÅºSZ©Ã×SpÛrû‡e­VWwhÎ%Á+óIƒrfóJ¿ŠIïsızİ;Ïî61‰%iº…Jƒ·²¯…wGyËÉ1»L¢#ö 78¼8iªá¤ó’!:ÍX’³ÖDÎã“…’2«böNÙ¯Zq}rz¢x2w	a„f¤z‰KÀ“GÆ¬·±ôxÕí«k\mÎ•ÓÃF‹œ°Ë	NP@l†_Ë™{¹=xjfKMøØ±Yõ9a'xõX ceÍV4øÓH|Y®Â9Gš7X—$kå]£œÜ0â	ĞËx³Dhc½fCĞ®c8&)ıW:&a•¼S–6‹ 0ğ_l4ë€:5„uW>pYä'0‘ä?C8`¹îÍ¬ûÏ=iÙOòáKÃˆÏR•Wˆ²„á¥Xgt 2ôWñOPaÙcû şÎ›2”
Õ+|ŞQ“|uIf_À"úJ÷bMœ`Èâñw7»ˆ*PÚÌ&£?v2Jwáâ“À/ 9Â‡u‚sw/Q//Dµ ö“oÍUa½Fß-Dº!|.…’	ÿ q¶¤{Xû9¶»~pèvG€rUïY¬Ö-V¡ÇHFo½I Òo¹Ï¬o\ğ­è¬³¿ïßñùİul`¦¿Lšs¶ÍOïéÈ;ÂÚ¡Q¼5øòôÑy÷`3(k| Åİj³7‹â"ÎÎıú<3cïcåKXÔĞdÈÿ»¦øú?åc¼,vÉÿ0äËƒ{âè³ôK3˜%–øMúRyÙf|ëyØ4 dÄğïQ ±
ºÄµeš7";š…áú&TD`ªS'$«­ñRm®Ø›¯¦uáqò|'= ü>¬Í#íéRÎQ&÷7¾Ü]g—àm§SŸdssğuõêĞ[
;3Šâ+7°“+èğ*ôÍ”x¸[ş¤¤{WáG·µiö‡âùb›•}fvmRÍ·¸FÓ_€İİiÜ‘@¯‘szÎhñÓ¿ßmå–°µ2t^Îç¤‚ÁÆî¨ ˜°İ,$÷…!õ5`÷¿Æ€Ôn„!íZ:2l£S,úŸáaã›üƒÒQŒò|”iT!W&ĞéšPÿG`(0FágÓÈ¯;{Ó–^z¼;i0ø‘-I¼(êFˆÂL@!Æ˜“­WŒïp‡ ¾˜oEmäj»ÆwõïÇ„şcî©CÀŞ³Ë»iEå³’L‰Q¹Ã«ä5çÄ³òÔ*Õá'³nâ%¦Ğƒí?,œÒüÓTë;“c¯¶mS2Ûİ}c®-®pLaÖ‚©æ>‚,ø°Ñ°*&t{HyÖàh¸Ïšï¼µ{î_%
QŞ%ŠŸS2øls$?ò*å"ßÊØÀvIfS¶«ñbhhõ± qš—OW®ü0çÂÍ_VÃw³=àu·…üùˆŒphh:av©¿.Ç­Ï¸TW¯¿;†Ê«L5oêAÀì3ûOş=èìş|!ÍS¹ÇÄB
]å2Ÿ4‡Ñ&ó±¼Lõ¡l…&6¾B•é¡»æ•?wÅ«ÄûóÏ+Ğ‰Me‘´ gd°ˆŒÖ.¶ĞÉªTQ„/ñ Fê:a{™‘sÔaUË-Aòì•hÌØ-Ñ¬fC·÷z8ğĞª#¿Øæì$Çb$q“ œ=³£©9²?ÆZöÎmÀeÕ–ã91¨$ñĞñ‰¬Õ´Ãş"­Î± Çhß´²º™±#şY¿ÑÚzÂ6ö×õ93 ¢(jpÀ™¦¬¥Ëƒ9³]2 Zi‡á::1Ô–)våÆv&/æÿÊ:L„k´·Óò}¢zÅğVkQBT™©Z3®ÎÀuŸ‘¨× (Ë¿3C†¡S7+Â!¸|‚®QÁájˆÇÁ0lHÜÛØdıŸ¹â´|¿,´Ç¤äüWPË\íç¥ì¸3¯u±µG[Y>J±#—|¦%°Ğ´(${Eç…>ßŠøwm!Jş“DÃ<†Ú‘.íÙLm3ƒ×w»ô©!g»8†˜#‡swâW×³EŠeõ±1»»ÔJ¥ãr×˜ôÛ‰~û¡EK?½ø'×°2ğDD'Xªôüƒ†‚b,¿ò!nÁFìOË7ìYÉJìLl’€?M¨rÚâ¨š¸İâqûVÁ:CÖ¤yá!zk‚ğM²|‰Eöµ‡òf˜DwhÙ,dš§÷ì˜Ïpss¾ÓÇ¨Î‡1»`Ÿ*O$¼*"¡‚=A_ö”loeœÖl`ç®Çº Ít®ìöîÒpËˆ d£­Áy¸ÿ§5@¦ÎÓ„Ì(Ëşoì3<T.Á3/ˆˆÆr9ZÈCKkò¨ÑvùT±eû~èƒ_OÑöÓ­}¥îà0ï‰á±ö#ÿRGùN¸Ë<u	«¬Şd±)Áÿ;‹¢¼ÆÖ[ƒƒèT¡ Õ#•ëyÕ.¼fÛoT¦ì&P¢oM\Æ¸#=(<£áH¤i
+AÆ-ÈxÑİÖ»´›a‰âò1»Õıá)Ç•¤Â&ıyÑ ïZ$•!µ0²vrõ!X®í¤ÅJÓ+&ı~NH§ §¬L?Şç'!ŒÌUDÃç1¯¸ï¡º»×) µ×d;©Kø9ûëspR¸dÚ–‡šñX+ó±Õèß÷y5áâªîw3ŞòQñëW 9,óàÎXëöq²¸ô—Qu
(avL§šuSGüÃ›CÚèq‹SŠü jÛÍ’š²È¹«ªÀ°š5p¡r·Â=]¨‰IãŠHâ˜rb®¥9a;¯ #Ó³a3e(ÕÆ‹³87™‚æàE‹B ¤áßmØº,æ¨:—º¥çFô+t²1Â-_'\¬¤öwå.ŒO¸—€VÈh™ùo-™ˆÆpÜ½h›'7øĞ10BU„+â}¡‰Wÿ+ZË2Š\ Â(İ‹úT×ÔÆû«çbû³µ%±ëÇıùM	nÛ4=©õ,$*Ÿ	0àÂP©ìP_„öé2}
 ½Šva©Nó”Äoí¸+ÉUQí:á5äè³•Õ]²“¦¾|>n{ÌÚyïcÒot¬-”¬_ãòğAĞkéâWæ’vn„³Yß‹—åëâ¾<f•æ p¦ß?â7XóV&£A?äTíº×
k˜÷˜kšL„Ê‹9Öá1w-Ë~£ªUµj];¹5Õlî²"öû&Œˆ¹µ£5A<ç1ºÓØô|îš6L³bIì<fşQı>ï¼j˜ûàFo¤Æú×«Æï¸p Qt&±Dü1ş²}ñ0QîbÄ^<vÁR¦İÂ<•/^¬;€ìVê—]NİR¼éˆß–ãk3#:+üÔÒª´j->öû“›#`D‹—ß±şlÃ‡R5·³4Ôjİ²ÈãO{åäşÃFí´a­1]PCLÓù´‘¦½­5a }ªí ä¤4Vf!œÂPìÙp½KÔ$8‡‰Ó!ñ0ÆóßµÿºÍjMg^èÛ×QşÓmUf9b»oG£c‘`hÇ@ÆŸÛ,ÏÍzªÛ=´@°Ö…wñ¦ºWÜ^ZXô…ãRX¸2giù·b…åsá,Ìæ‘Iƒs}–²^­6eyHM`‚UP¹ZH¨¿İQ(‡„“íÇTñtÌm‘rSy=|$*ær0èQ‡ˆ±±ëF£Ë¶dÙ°Â’°w°Ëí>•±‹–‡G9±GJªznéÔ†äRßÌjÂ’DÌÂn(.\ë´znŞq¥	t1Y¡ëåª«fB3ÖDÛÛ‹Ö
áë²´îÂe¼²›gGàºÏWàHüÇ±|Ãßşù|LºAÜkO*.Ì·¦bwB¼`$¬Ğ'#¦—˜
n"{	°³M0°œ|îq{VHh¼¼4äîşÀÿV½Ş“éñâşÜd±-½Fl|†+Í»ÈÎ__É0ıy{+æ“wO•DN2¢€±#}é³ŠD¾Û‹¶Á›@^·x°ÏF¹>aƒYß¯>c4ƒ‘´ÇÇ^fA0¨/†àfa2-ˆñO$©ıAéL(lƒp´€×V˜Ñc @×ˆı©Önó¶	ÛI6W`„¾<Ó"3nØOıôî†ƒBŞmşåÍæÃ‚,şôû{ÅHØ›Uû§6µükã!jhl‹ÈÃ©Õ‘l[<í"F„ÈE?H¼ëJœÆÓ…!$Ù€H²<°"aöÖøYöé(ıbsãœW2ç”Ï©  «£ƒ;
IëÈ8İ|I";$IáâsôviŸ›¸DuÍÒ,N­Ş¸N‚][œûI‰^½	8QM7‰ãéL	’ wã'4‡_P#Ó÷Š
	öà­ğùtÆ9<ƒ6úFüJÀ @÷&¯ #dî#ÏffSX8Àhó÷Ï3“ŸÎBØŸEêü4Û8íÂâ¥¢ºÉÃÆöM)W/´PÀÛ¦
ú ²¹ª”î¹aÍ×¡9æóšÉy‰Rg¶²éÿ²!±®CÖÙdÒ7ô,÷§e½°YáÛêÃdGgKÿ‹"!¦jQó<ÅßÙÁ±Zè>û.w£ ?BÅšI—Ÿ1ÑŸw)y T>å$_}[˜ö›âhïÆ›Ù6¦JyRá.5¡—¡ÆŠ" ì3€’İS˜ª¾€`5…6ñG%™h^	e	XƒM?ÁÕÇ»_¼”œÄ2Lø>ìâÈ m¾ë†Kƒ#¬nG¶ê|³ç3kÄÊ­ä Ca;:]¿åİ9jjaëößÍiXA¤4Åëì±˜‹;aÕğs(sSkS¼7ü´¹kr™^'Õ{Ëi-ÿMaíÈá©dtqpÓ ~™^1Â7Ş­’Wó<:—|L ğ+G Bw®âíáG›ï«gÚƒ™,Mü`I›ŸRe•æ¢ˆA€7.÷ñ0TÍğ˜âûÎ•3VT?Ğ„…§{£U½à+x–CİxóÉlÀÀïh¸Ù
:Ğ\»°	˜‘ÜeÑ“È…G 1ƒYœ¾B™®œ¦Ÿˆ+¸5öùµ¾²ôgĞï¶ŸXİ³Ùâkíp^bÅ»™€omİN!7¯/(zCÿ4 IÏ”Q¡.];UŸÄ®Ç@$Ñêgµ?a·ÜñØ è)+‘šà:¥I–ä‡{…EßŸZ£a~9É‰­QÿÏˆEEãl¡2¦€<j2*i@ƒ(ÍÇœëH`u¢$ eÆ.ˆÙAş…ÌŠ[5XçÊÛ­lxZ“óƒFØ•ÅşW9®/VË*'R.V8™Y×¾nãÄú¶)õ¿Y€¡6®I¤u®æn`L\ù23åjxµ9gc<Ï…¶fR#½ìíÜù>Aşês¹İ7›ğ‘‰[áŒ¢WípıîŒæSÀig0
‰¶+no9´	PJÖzùÉü‡båù]s“ìÊ›İç¦IAÁ©f!l•NN›Ô¢\39+i~{e
4f$ˆ5LUº·àÆOtc"ïÔé^ï0N#„ñâwëÙY„|Q«CZCyî&R˜´®™ZãÚH:êƒæÑI.)Où©ÆJ:è‹!TÍ¢abÌ<áä^Õ«XH0÷Cª`¢)¢Á‚ãZNuƒºù·ùaØiÒ9!&‹÷AÃV+.ï^)6¿Ã†D•%r¶Ğ&¶Ã/OoÈqJdÎŒrUZ
ìêWšrã:¼`Ï0¦}¹nè¹®_õ“Í&EŸ‘ñ,ÛPIUÆµyªı°òFqKàªú®’ë^™ğyMMUÛi;ÒÒóëÃÑŸ\€€”aâ…®“»IX:'¼ı[mè_U.’É°h¾xQ%k|nÎ‰L•":Æ‘œ#yì«ñzm”­·Ãáeœÿ³iò$9ÿ€ÅT!õ-°/›@á^ª„Eñ«l¦hC˜\17T+p è	È5Î®4y588ºÆ§¹fX–M¯V%¬Ä+O¯ÿmR¬àÖˆ¿,æ'®ïĞ·à}×6ÊÕÚ}ç×<¯éC§hp¤Ä¨mZ ¹c9Cm°C‚˜`G­«qğå[“äûZ6qİ%é=ÒíöÅ	öÕùéëĞƒGèÜ9V}ëé2™ =İB,Ü¥HVMIvÏé<h=ÕÔÇ'\7L!ñ%î-¢(U‹-0ıË(Tà¿G`¼
ÑèKæÑ4ñ%Iı-¼‹ØzÆC¤î!K<ª?eEíâÏè*~^{2åÿ·D”†™E‚HÂ0ŞH4…"†C²Ëö¶Çh6m-® öÆo{İüíJFW>jĞ€pÎvwûn,â¶cmØ)íğphœîîz‹–#T@Íá\Z£:xàá\ds8AdFª‚®/C<Ô•„ŸOöû™Øïfô
½ Ú@4»FAÒ*eP&P•ÿNš3>@ÏSWNß%¶Áoès}uy$À±œşöGÕ»ØÒ°Äh·@”R[±ºBÈÃFlÕ)M…ÄXÑl1¤å¶Ÿú·1zôÄ4´Ÿ7¬İE¸&Œ l3Ğ:ÿ1¥,DZ°Tn3¯)ZâºßF€®¨B$"Àö„µıAÍr4…çÚqØW´!RU~»‘à+ÿÆ;u÷~VáôaŒ0@u§XĞL¦âlt|t]3aLŒ|ò»QäE>º,_¡–`UöÛˆa‰ÍYÙ~WŒñP:ñ=áeûŠ¦Ô²¶wE^ j7Üà¤h±o FG(£õ0ŠKêï&VuzYÍ¢–ıÆExÌªÖÙ)kkl;!Ñ’´µQÄ`Æö{×qÖt¯*Š};_äòM›Ùş;Bzc l­Yœg’ß$%Ë-’ÇİGsd†ò›ÛÉÈà»·DV¹‹ (¦×”ÜïyÄ‚o9Æ…¢uÁkÉñËäµ/ÄÔOŒ¦@w²Ñv<QSWh‡Ã61L.â†m-Y¯Íxÿ;kÈıßùôßÎ3öf­(›Ï†Ş4£úÉ}ûí{g*wTB2<øûÊQQHîò ^`¡Ÿà(°‡xŠäuğ"À…R²G7Ù¹?Pçûi¸åc3ñyö:ƒplÁĞAåpüz·#×¼œı!™j±äS¦:¢À+I~ÆoœÓşö}
$‰ıD
_¾Äöá­‘ÈñE‹föµ›x¶Tª¶¹`¸2IÕ®£—5gùU|yŠ9Ñ†É‘ÎÃÁÒ•ñ»Ğ‡0D‚^À%§FûÉ|n'#¾NZ3ÙıèÈ)·Ù8VÕù¤kÉîæœL0_“»7>ÛCr‚¦WS<c5¤I·‹<
¤…o˜ªyë†½~àeæ!3‡N¼QÇÊ{æ*®ÆÑíçı QÉ%Å<7=¤•<C§ETñ±à“`Û
G¶=ÚDª°¨&7‹%o­Ÿ7²G--¨nåê¡šx1Â?~nªº–ğhvã!Èš]fÛMd˜Ö@*²î_mAµ¨Š.IàhùÄ±ğ8²‰† Y´.£Ëß*8Ûà˜Ñs¯<XhİÖŒœ7†ÜçSœn¿öòğ£àkÂ;w¤–HÊâĞ‰w÷™ÇÎ§ZA?=ßú÷ÊŒ(1âZ2eû<âŞrşÒÒ–ÏI<Íç|TÜÅ½–fxÊ»açx’—}ËY¡~Epåİåç”¥İœ,d‹]AİABÆÚZ]µå¢íJí‚\ŒrÎ/uöûò´;°,­X&q&`oË«™×VI¾¬¼åŸÊÍTX·§çşÒwL¥¯Îg®cÙ(,@rÁ!òşöw
éÏ½#tbŒ ¯ıºU¼ƒOs¬)g5aeıã™ŠšêŞõXyß•n$šfNBuõQ,z+væ²¿iF¼¡LC°idû£@©Ù^M)†QĞu9nÖ;”E¡oFRåÁ´ˆµÃÛW©ã€JÉ›¬±Fğ’©5Ü”ÓEÈB"5
× R$WeÓ}mdË¤I,º*[íÙ—„>ĞúÒÎaò¶„Î‡î<Føï‰l„-×Ğ<&8ŒdDO€~ÄŒ–Ìè£Gs;œ©<%ßáòÕrÀÙ5Ñ_½¢%ıéÿk/Åé'DÆ$¬(ÄŒœê“ÃœJ˜_ˆwD*š«‹1Ä¨P*ãuÜ$°QpnŠ9J”)DËAÒÌ24ûc0{ğÁkMƒ‚ËÆİñ	í„òãF•‚5Šä	g'"5 ;<ü±ª;_P}Ó€O«ÑAq;øEêoyÚ¢ºòûŒ²‰éNGgdŠjC‰’d¬ÊG¥é¤€^’×Eµ"ê]{õ¨€¼M-\Ç}lŒÊÆé(Ÿ-V@0ÚÈãâM,Î•
Hå½™<òÙĞg÷å—Ë•_1îÉP”:ÓÑ?NXJ§Úí-
Ÿÿl<üÉJš­[Wp2[©&„*»İm¯%,ûnõ§IY+‡Á%“TƒiGÔLâ[D{5ÈL5¥È3JPÔá|¶
àÅ‰)éõwršÙ‚‚@{£¨¾7AÖ?50¥Ğ_ÄCÔ$ñ?\Ì€µÀC‘\@'T¢ßE€/L	9˜±û®/=H\û”H+?ò;z†ÅJ”-i±’V$ é+s[úfì!aÄâ8š\±‚Gqa'×²Ó|kaå&&¦bõÈÒ# ±åú‰.Ú‡w¼Wúq,UªÏ21ÅàÄzz	áM7<,</!¹°E.z¾ÌŠFŞŸ[A¯16a¤6ƒ%¯÷ŒÉËÂò¹Œ_´$Çß“&Æt<][ë¼"é¡îJPyÿÁº#H;½ìF”<9ùîf«À÷²‹ZÃkÁ~nZóOÇrë%2	CšÙAùš?¦ÿcl`1Ï´0’G¤ükq#f"0ôüXEõ¤æ¬]iµâKúç£y‚ØŠÍyGÃ¥iÒ$Ú`€Ó¾·…ÍöBï˜é•|EAŞl2CªÒ]Ç9oña)»Hİ\û›-0¡G<–±’«iİˆ|¥pß<Ñ 
1¨‚¶¦–`+9©W‰è3áÔË_Ì­lY\š~°ÜöÓdAk_1Æ½‰®l@µÿÔê€Ÿj®@àfäGÚm>’Jş®í‡·?ç‹JWÙu¸6«]Àü.7šŞÆQ(¶“K“VWƒ›ªªº!‘ÚV~iDÀÃÈŠ0@™ı‡¤àA´–Ş™€b8G‰”ëâƒúò¢%¬.sM¢H…	 µÎ¦³Ú~Â‰fœ£…aÚQ†¦lµ¿oÛbqÁN/Ûµöõ²@LuúúPóğ‘hX­L¯²áÙéMVT»ğğ°ùª”;0$ùA`A<èĞÄødŞ6€^8Ëãr®\¦ìç$_»ú!§4½=R)#âèÀ´æLäRhm<ı|è¤|±¾Däw¥ú.aãòú;;2W´³åªÕšNsX éMŸ9_6bfØÈ2f’¸OtCf¡QT¯Õğú ×x‚ˆùâ¼w¶I¶¡fPĞ ¯Ûñw-‡¿QÃz÷n7·) &Ís!P©Çtš	í(s<W8-¦©5Ã[!útNÊUa™fmÓ½9=(+Åİç1;dì8zÇ¿P<ña„,±F­¸tš>ˆ@‚•äHŞÅ'Ğ¸øÑ4I´I£E¢º/ÊæÁ2•¹¹•"¥š›§Î-t6˜tšazúAı¹Iº FÁ*†¦ğaÅ7œoú¶òæQ»«zxíˆ¼µ\ªh*)¬ zQSKe'ÅÁ(°Â)sÊâì.¡ã­'Ù„}E<?Í5£Ò®ïêXÿÆ™İUè°sŠ€ú`y¾b$KÏÇ®	ç6£Xºì, Ç6åR3ÊK‡ªXÓŸ’´™`GÆU˜!Ÿ¤åk=š¸ì&ˆ>S#1¯ÛÌ.r€¯“a¼Ü›ó7¬€ö¾W!näv½3¾¸jUG@ç0™8VF©]MÊãÍ$³ûQ6·Ä:m”í´½[Éa—Ã	\İbJ¶$´M„èà3çBÁp¢ÆQÁ†áD»õtæ–;ì»VaØÚ«:#†áö¼Å—jp*²¢¬5ÖgˆhÏƒšŒÆÍÀ˜2×Ôfaèß¢ØhÇb<§bJòöç¸¿ıÖ–%7×v‘ù_*Ö°ekšôC³uä\ ÄÛNQØj—(ö˜Å§ªã+%”¯'ÑRK¡¤8WÔ¾iã
fêÙpYäü_`vsÇíó™Ò˜«°ï€M_‰»Û¨_ÕD}± ÇØ0PhNh÷ ÃÜƒ¢ˆ?šw ^âEÖî‚5,s¥ıÈ4*ë.³¾T†zÈ±³e•3N¬ÑçGµ¹X‚£‘İ7í=¤X{ Å(4|q´-é\½Å¿Ï¨ç¹äZŸ‡ˆŒÁR‰±j	’mCõ@7Ãi½ß†Îqğíxhf%S{œ|é#zuÜ¼ƒIÊîõ4)¶á	ùjèl[q½Ö›ö#º˜¨ˆ´£:"lp1á:åcl\s|ØÂ~s7àùéhñèĞQk#·ikš–b¹"âìAoû%Z ó°xŒ°ˆtLYkË ±q9s>&€g¦×@×ƒş(6áúC	¦vK²ë32Ï?A‡F¬Æ0·ç¯{J’ï*wòÓÜ”¨5%­¶Ë·€ÒC4€p‘’á ³aW‡ĞrµÁA©üX‚ Ÿ~,-ºNätBÑ,®‹³É„z“JÿpÖxd9’&zä¥™ŠÖ-`Šg60Q—Õ	0” üË@•£)íSƒê•®ÂŠøU¡ÌÖE£G±v4À,[u#œZÌ´r”÷ï˜ês²Iì*…î3ÀAã-ºiÀ¯ğ‘P€­ÿ—Ó­õJ“•Z¶ÁŠ[é«·
±ã¿ò€‡+3pÅH§NW¨âª0jÀ`ş0’ƒ«‹y8+$0O_ÀÒªéQ	Ÿ8>¦æm t†ó=m£CXøf—éæ tWlşÃÌ$@×*;ÇŞ]µƒ<‰Ï[İ`>†ÎÃÛ#¡ïDWÂù“õ½ÙÆ³Âi\‹ âS®C…k¯ş8w s™$×Ì‘G_öo¤NôA‰Àyn®“Ÿy²èÅlPŒÂuTõ<‘J÷w ÚAimª\¿1Ît\ëRôï
½­¾œwéZ®“¤É~˜ní¸W¢l? Ÿ
û|ŒÚ¾ñ? ˜c8å…‘íú@hğMö/½ÌPYØ×‹­Ê1yàhVèúw,Œ ¶'.‰­?ÄÔ¢)3ÑWŠùDM­ğ8â©ãí]Ñ¨…ºY£A
ğøúìß“äÅC|ß­4¼#{åjñí°s¤ªF)ÚJ)kñÎãˆ/OwÊ  N\Z%NMüG®qº„ÎØÒR­ŸŒ\‡¿X"äUy÷Q¹Y“ßçâ°K>ƒ4XĞ\›øØÔÁöÖbÏ(%~+-Ó1œ/ğ631 B;‹—…¤f[&ìø»ËñÈóÈ<=Œ|œ¾gºE›^"0@A]ÈhTuoQcQJèÿšø~ïYÑA›(ÊœŞæ$;ëÿ³Ÿ¼c4½¼b4˜BNTÛw î¿òÑD~J&ãÍEÍpî:T¼§K†6™^‘
o[Ha­%È4&ÕÃØ(Ã«‘hğ<àÀ»®ùÀ@º+’zİ¨	aKçáYtıË(fg	ĞòÃK%‹¹÷ŠÉÚÉò‰•dÜ#U›+×Ñ;¹°¾—ùŞ˜‚/á?¦ó£nÄ-œ—¬‡ëÉ)df®àÈİ	K×èAêÎ4qù¿¡Ø
)¯@ÁÂ3Å¤ñ¤ÆÉo¼Ø'…L¥cavfyq10‚:Q…DßÔz²µ¼;Ã4UT+úŒš‡w•ÿ3,7~Ü8¯5©k,+‘ˆ ùŠ>˜ßÅÿ,sºXZDh&LRYlö°î˜ˆMè÷İÅdÊß*&³¸˜DI”Ä«ˆÄ‹êz¬¿=ó!Oƒ’ó‚ĞôéVê9¿øİ}½°kÜ±¿ãÍ«R`–Ü7£%/r/ÒY¹Oé÷ªÁ€û^Ûÿ‹w(gy~Õÿø>™›{x¦0ì+V&b°¿:Z§©‰QôKÄ[ S¦‰ª±¤\åÁáıÑë­2†°@U“u:3ÊŞ‘6wLú—B>ëHrmÌfMd#²	fÚµ€ÉÀÁuêN-/ŠĞR¯—Ì´4Ş¾{¬„Óû¢/Ö¼Ç“¾4¬¤[KªÕP†&eçH¥ALèVÖî»àü5Á´gjv(e•²P<làVÜP1ò¡9S^¦R(Òù1ÎBEa ]9ÇY(ójßCP¹Ö½RrY;[w!]È¶L²³>ØØ^@°
âÏqüâÄ¼¯°(MªN~¯¡õå}Ãy´'¿IY¼Î’×9qÎ¢~’aòûFªNöÏYTNÆ‚"ÕóÈWã¶–Å_ÒÊ%Í±ğÎ½O¬‰H¼i•Şh3ZYT$³u«ó40‹_¡Àfú•“ÍÓz6r^	×Æî:İ³äªÉœ¯>YVŠo‹å¾:'O÷cX$86Õ¥±ÁÍ}mã¤ìtO¬Ä3æÛgz~ÇğNz„Ë™@—Š2©PZ¹z¦9Ñmì0A„|5ßÄšjGÁ­İS¦eÓtÛù=’ZÇ2ækC"	;¯l[»¾Rÿj†%qâ²aÈ­¤ƒ5]œieCu+ŠÔƒ ‡N…‘W¼ÓMcÆiøyëC¨ Ô¥KÃ­ËÎšÔ¾=!rÙ9cV ¹§™ìdŠ-Ûğ7è¯/Â¢Âê©`æÜYÄsºá4p[lˆ¤£ÖZóèíh“Å°eæí
të´;æV‡„1Õã»MÄWÌ»kH×^ncí›8Æ(<©~¶Òé2Ûk@ÔhÖ±Ì{ašS¼81ºsPP-¶Ñ)·Ü%ÃÚ\“ê‰BuµIˆ·åkö†»¡`œ,çŠúJò{•KÔOÔqc'×,ˆMT7'pxkg€a`ë "TJkßÖC†b(ù¼yHÙ"FK5c#šÙyˆ¹œÏêFø–>Dó'BÌiĞ^­ÆOò
¡“ —ÇÇjØx~mä|º–ù—ÃøCJmÿ5üUé0ãŠÌ¬nó5|Q<¡”P%91dü±8dğÃF&8‡OF÷}›QŸxt4j/v6Ş>TƒşkşB=¸£ÊwâÇÓ6ÅŠŸ•{GÙ«†›Ğ}ÄBOkO–‰í^ò{%‰z)OX»Å'bÇôèÜ3R;Û¼AQnS·$m"£7S‰9ù„Š·‘zWÓmş)Æî+EÎL}‰É
¥‡uø7™mt&#„­O°­a v1ÄéEø54¸[>Q-Kïø½ëA2³FjM&ôsA¾4zs1u|XÔ[9ûãÕÿş§øuë
À%lß>j©:†İq|
	S^o~äÛ P%äuÁWßç¸­ö"Ñòe»ƒNwº~RpC°Èšÿ¬<œ¿ô‡¯‡Î+Z«5<r VF*é"—Ô‰=0i3xø˜³[šK~0‰Ú>NŞ–s¦!¼‹ï
Ş™–(˜ÜN¾l@Á8¼*4?²!j@@û÷ÿ^v·ûƒ¿ÁÛŒ&r¥aqe>¼ÿåivËÇè±¢tüĞ8ãÍ:BæÑãô/ƒ§ş¡9ë×@´–
ÿs§4Á/QNè},œóÿ&m!g«^• ™me¢? îÛ¹ô4pø¬¯ézK¸õ.‰kÈuÕÓƒpM×s–L*_MQ01h"û9LCëœ^/†3î¥Ê˜VT9\m^ ã‰Ò¡¸/	©»¿GÄHLÀL™ù]d™‰t,”fØÔä/†¬³Ñiˆ.¶ã¤{*o“YëNål{ôs¢1(:
ty”Ä•G?L‘bT1â.È‡(<jã4Ñ'[VÚWoR‚¾C~Á¼¨H³òo
0:=…ûµ ä!¾Ó>ÜÉC‚6ÈnµY«tf>i®ê@\¦ò³ú¦şñ°à«%Œã‚mÁc£d¹ü~"à~Œ¼évˆ³@¦ºÍÚŞÎÒ‹Ğ“süçµÏR‡LÆUôô†ØCgK¨ôŒ{cõ‡]e¢æø–œ+ A	Í@¦`Q·?…PÆöªÜG»èÎ}ãSÛ“g¤¶æ_y¢°çnU0K1¼×ş¥j.ÀóHL¤Ä¹”¯À^éA¨ªö>~BLZÎL¹L+]¾ŒìwKÄú€ÍŸ¹¼:ÎÓL³ş^hâ¬Æ¹löã‡£6‡'Fûx9‡7µ-^ÖëØ9«İõ­rz%;yVLSAù…êEÿ–™_æMë‰ ˆ¬ÇÂl?šÔç1i¾(¨ØŸ€—9ôÎ+Ï)E­åÄ’•OæÌÛ‚#>VX¹u%'² Ñ–öÚG˜ˆóÿ–ÒØ`¹c0!Š»Ë—Àêª«ò´ôÜ¦$=¿œföÌ¿Å0ø?.êuÑçÚ"¬Hbªè’¯N`¯ŞÊİª›ôúœfÛè é´EĞêHÿí/¡ó¤vv‹wüùjpõ¾oZ¡*Š,,2ÇîxÜZÀ})rØç¥³[-Šh½¶Hb–ÛFÔVµÃş˜Á¦2-”úycãa(–èFOŞ=>¬Ûv=÷r¸`˜ëbeEÍ—Rjã€m[^®Ô1qFõxzYèA–ß¨ôî$à?[?Ë´º¼Fæùşüj>#AÖÊ+ˆ<”0ÖÏíÜ§P»€g¹8J$äœ÷LqûUi¨½ô¡äHô¸òß®êF{‹<µª‰¢A€EMoVŞÒ’ÃşAÍôâˆ÷ğïŸªjÆÖ'sÁq$¡ôI§6aÁ¦iU'Ce>MéŠşåzÓÆ*O+A\
‹ƒ!5NÛ%ÌN89}xÈå,‡H”â›©ÊÃ_úš“‰oo¬´,\„0Í£‚)´"*–ë!:ıŒKÂ¦¥ùò¡W5òùôjñºàHÈl-­kOğı
–¤%/­(·ÀÆ+{ãiÃ$bK“é¦	F\˜®oëÄÒ¼3HèŒyJ%(Şl©õ”’× ¬<ñšíçŒy«ò1¸¨‰“Y9\¦í›e¢Ÿ3T}GÃR!zµâP“4æŸiˆ¡pÚŸüäyÿ%zm¯Éö´¿]išË{6÷0¡–ûN¹X¤ZÅ‡ñ£:¹–BPeÅkgû0‰ÄWØ6rÃI^}²qHa#ìY>ÆeIH‡‰iÄ°xãÖÊÎÂöf?é€äFæœ‚šx$„éaY*!µ èv¶Ë9Úº0x{JaRJµŒô[;Ìàâgß37*B>0«øwùÇ¬Êî»sQN÷2áFşR5ôµLqvËí__wûÙdïŠ±4Eå0Ó±ÄµƒµÜuPÆùËğ RÖ>èšÙƒ«<Ø¼HHQ„GTŠM~'(¸G0hõÑÍ°Ô¼D“ËMÿä¬Âaõ
Ú±¶aŒè2Õ•’§Â»åSÁ<wİÇB²4GîX3)qXkæ³÷«Òg}¥yEùì•ÆZ4Â¯.±?z†¥%!"Çßä~/6…’k;	\tbóÍjÜè‹ôÍP$,å|EÌ7«bı°‰³•ÜË¾şS;VŸˆ†“p¤^8>
½¹˜nÖ1 ™¥€µ{•-ÙD¦”`«=‡[™˜[*
2êpªê»2Ç¥9ç¤« ì|Úk-bøƒ"ÉÖ€r2F]I 1ÏBñÊ¯wP™?ÕšìDjÚã¾ùˆÌ,mÔuLš°ù­72Ó•[O:`¶™t=§¼ª…®nX“@Ê· õˆİi*Oîî†½9êsÛc×îŞv=â–´±Exáayz˜Úì4ÂÑÔY õ-·sGrêôdÿ«<¨IXGJQ:3;•hï¬Æåˆ#~;}[A“™R7´V9…†¦ã47óá´#ãQÑÀÙFÌ+-Şm+¼¯ß©*u "ª=8!–!á2)[¶§€ĞÚ!Ä·ów—^©ï*t|¤¡e_ºÏüGıãsÛíJ"[<~cÂæ¦%¼ØŞ›,pÌ,`N¦<Fµæ.Òx¡ş¢IÕj –Çñ=Âğ«ïh¦ÒÍêòŒlîÀ<kì*nÎÀEèpÚÿ¢C€u„o\×¸ü´öı4NCÈsßD¤§Pb’ÍPãÌ++¶ŠV´L™¡¦æ¤…ğ£›dïÉCzOaˆI[t&{}Bs*×AU:ßÖJÅà²7föÏÉä	¹6"g½J²\ãIPš˜{—O¯$µ§ D—_ı~PjÿvÀ:—Oj½øßÏ«ôa¤4ÑçuU2oñ6-¸©yä!h-«:HójŠæšx6nãOJ½%ôÔ¼Í‰8’è¸éæÏÚ$Z©NÙüweóâñ'%×ßµ+B&  ZåÎLÎ}:³ƒhzØäÉÏ¥a@Z}65İá±ßÃ&yÀ‹iÒt2@"—úÊZM´ïX®.É¼ğWı~¢ñ,š¡*°JşÊ%È;É	^£3[®ò?ªgÔ”’5ŞÓ)f3îı©3q*ıÆ9=C@Dµ;VB$aª¤P0“|üúìú¶b3µ€ªÈX³È&ÔwRUØCBã‚guä®ğ=^véâîJbß0nwjŞî»„‘LlqÖıG¦E[vî´•–1•:ò0ä™°vÇš¸?ı,Ï4:³|ÎÜG²mŞçƒkãl[ÊxºFoCAn¿¡¬)[ü[÷é»wL9EŸ^ª„y»bF ÒÒPxÍCeúûqòàjxá¬$K¬?&`»—tÊ½D/ı÷¾_Fu÷.ZÊA”;ÜÓ^AzY7ò‚òÜşÓMÍÑË.–^ëb0@‹ÈŞ•hø”¢_ØÉM_W`¹¼pª4İëÔš÷fZ3]Ô†œI½ÆäÑüDı&x3n^‹¬g×j`ò?ôS±î³…áªuÙØÖyC¦£ÿ›ŸLõä v(‹\ûÆ‡¡šáá%Mu&ßpÀ©	q£çTj°*æ-;|$é{Æ¬I%¼ìÓ·ŠÅ8¨=ÀªÿÛ™Ú[]²ÚÑÄïDÍúO4ïôIâ`zúÈ´81E=Û>‡‘”³~[œk,jÉs¹ûş£yúœf9AÎ¬HÕœ’P°±í¯òÓsñS¿#ÏËIíñ‹§Ì:„»Ç´Ñ#ä“ƒIƒFõä»ñï`ÙÕÛÚ'¾ÎJ¨1÷d­@å€^eà¶h‘%ª¤0Á–ÿ`]âJ‹ŒÇ¶8¢5„qÀŠõë¢)îPã«„u†Pz8Äi·ßAB¿¾à
ÎËñxæ¢Ù/,zÜW¿ş˜ü™>5  n~Í|ÃE6yÙ…ÃXüS~‘ˆşs©{oF³Òo±(¡…ëÏR6¢JmS[Ñ·z¸ã-Bs¸pMF^°D|+iG‹úë{è½~Õ`
JsÖ¨wæ…*X¥¦d§“®K¸Vàv‰sÃšfo­pŠ¬ÕÂ7ˆ-a]=ò·úNgÄ5ãªÎÀÕïÍiYºvÍ•´´2Ü´ÑwÚ°Xƒòb¤ ÕVMJĞlÏ Ôˆÿwü\;Ã"Í†QÊø?ş«7V˜°u‘]_©ëÎ~}@&]öKÈ3!n»mªf‘há5¯¨£Pˆl@rª•Œ'¿úİÊ€SáÔ¸­>f¦¹mV= Úíy“5x´§ÏíT¥œxÚÕÒV÷((¥Q¥ìf•|šó²¾"VrgxˆOË™—~ÄòWøbu/˜9ÌİwvUØ›ÃI¨e\Õ‘P+AÌ†0÷4¥[\x¢¦ŸôâãŒD-Í±[J³9‹«Y¤9ß,‚Á3Ús>Gì÷Tá;À/m4N+—t#—jöùiùÚ¹¨ˆ5}öMTÖXÓşI‘µûàáæ±†G³_?ı\2ÊLÓUÏó˜cŸ„•ù»Kc±˜™¤*ğë^sÂÅÖ·;¯ õªtÿâİ_ìÿ)EÎˆãø}Öä_ÅY(7(ÀíğşHío˜:©u~ÌZm×Š‰³Ìò;nê\xfAkŒÌz¢ÖPµß6xìšb|æu¶mJƒ#}«.æşçG%~•RÙpS;9?ú‰àÂ F¿>8†ƒÇ|¢×Hı‘ö‹ÅõVòeº©¿òïúy¢VIû«·åçÂ©Pé´¼ÇşYiÿ4:eK’/=
`ß)ÿŸE(ào$åsêk	çz@Q¤€q	»¿Q07¹:Õ öªÈ÷jX£|óÄœ¾"-|œ<H‚Ó¹éØ¶åA%FÖdòPFÍÓ·G;Íí¸ƒ³@™Ó/ıƒW@¨äÃ'j1Öbxı÷ÿ¢v°Ø?æy„LuÄ­mãöI™êWBü²h&—Ièæ_1Ÿ6…£}V¦¢nõapÿÀÎ«N;Š´„Ç:Ô†»RnŒ
)mA%9‚oøéÜFÎ:–QDœ•:¨“@ó?“>€(aXüF _ØOGÑ7“cXJÅÛã|DÀP¤Vsç »Wl2*K'³0„ÓÎ³#×ÆUu•õ^Pá€‰®lÓÇ7‹Şºª?Wc,d$Kn´ª…PóH°âÜ˜~— òØ9…Cš• "eàİjÀ¢cŒ†øØQÕŒÓæòNĞØ³™ú•9K¾xêÈ5qTgCiÓ½òÊÄmö„Â§ä$®î$£RöA6ï
_NÑP3'äó´RZ“¬‹ /dÿÆ¬³|‡¸Uk¼V‚æ
k1Ìà/G³j©?–ø3¥Ñ!ì©ÃÓŸÔ{;­k|’Õ'Dµ›ZVr'CDÌÊ‚) vèÎ„·mZS†`Å'ı™Ş@E³Œj]~=Û EŠØä’Õæ3bŸœÃJÈ`ÁêÕ4š+l^äÀV»½I^¹LkNc›HáQkıUn›÷½j«Ô4@Ô®’ğ#U—(ôp¹@Úßÿôï¬Z‡tÕä—7—p/ óÔ)ü‹ş±àÃÄÎìàŞb²Æ„~¡˜ô]¾­¡-ÇIE‘<Ta-G–!½Œ{qçO<ë)ƒô®äî4¾İ“8ÍLDh™×bH=óîM	¡Û¿p°ËWª?…ˆwïôHúüRÆ´Ê‹×?oº1hæy`çYÇ•üÕ°Íí^÷û·•&Ø# pP0iS	?mTûğÜÖ¯’õáœ V|Îk<“˜ÁÚ¿G=zAQ¿‚Gì"ÂâàØÕnÍ¯ïĞBÒ•IğÊm÷ùQÀ9á4`š[ş0¼ÍıÅ<˜ûÓ{]ÏFh‡N½øœo:àï“è€ş«58R6:îrªîm\!ƒ\±>HıÊ–
ŒZÊ®Ì)ÚogfveºÕˆ•8/9ÈÌSlŠÜ’şl—¢T0O×¥"wÊ±¦ç‰¯ßüîìÆÒÃ÷3%»Í‚:)Z–•ö·˜øşqVn,WÃ´vğ8 Ø[«Qk›×½=$ÑtUKÑGlpEµ
W;C|­'âÑ%éh×Óš Š°NaW†å}‘+š;gæ×'ÜÛY0\G+Œş#á­ï£8’{¡¶@<tô“:oµ!È>® Ò'JÜÆº¡â« ÷f¦øRaE( ã²¶~éX‘ê‘üø¾’{:À7_±…Šhªn=d^ò!ã°àÎ!ÜT-sİsÅ{/ËBe«Œ„pR_ 
õ.S{ÁæX*¦`g*
»eÆ
'C&ÚT¹'Â"2/àƒÎÖØ\z|é³;zÿéô)¤"¯Êƒ²“Ğ*†–½şñÊ§z'hïœ–û¬j¥¤õ õÒÃZ½h”ØâvŞ€—”„Y©}Ã–8¦I†U_y}èÛ¸fNúr¶’áY ¦îa‰rmYbró'jVˆB¾$N»?ò£ºr)*ï&±•È'¶>iÒ2ê•B'Õ»°¼{;ÓöÈy¬Æ¥f—‹å³E2ÅÑğÿu¶¨<kÍz=xmpº\É2'€gÈ£'K1t ÌñÔÎ+Š<«M„kRTõÉ/P•¸‰ApÂpÒgSÂÁâ—ğøa^_(¥25U-g0?½6İì>¸MÕ¸ô2Ò¦HL,sˆË"¶mÑG;K$İ%¾)8¤½§šÇ9Ÿ(' }[Ö¯Fuè.­`j“ù¨ğìÚ…ále@îÍgW
vƒ÷N#ôêV£ÌŒµ~$N9XÎÊÍö	9—…èû(ã¢“¾h¯ÓOûdúÅúÕ·+(‘·ÒÕ$|âg(}@ÙÄõ3}¡.Äêêá@ì$©öÇçy¬©ĞÙ½ÛŞŒ`ÁØÉ’aı[…!#÷P/û×ö¿h]2ê¹„	¨c†•İ€ ÙôpPè¿í¢(V»<lÀ2 ŞÊZK‹VÊŸ“ôM¡i1RcÒ•ğ˜+i”õ25­‘aKğı„³¥¦úòÄ§Ô¹ïá7ø~]’ß7)b{2Ôër`øÛèfÏ[¾Àqú­|dê4›Âˆ¼ÔAñ,Èx+kĞÕš¾‚¯S‹I•Ä‘*•^GË7²¯g;dÕ2„/õÆ¨@Ô]JE@*k¿6½÷î	ÅÏº÷ø„P­ĞƒI’Šò@Õäÿ¬jÅ$K€ÈCvÊäZ¼ä­¡ëµX[¯ø3ßëh		.ºw‘Jw÷=|WIÎDŞÒ-°Ì(éİ“VÚÚ¹ç?lí1;şŞö’Ÿìgñ®–41…Å‚Dú¸@½|[c½— tXO‹õêÆ1Õ›qşz2wD7£¬‹ğ½ÄP`±3{†›$İğP$/d°ò]4‚ıÇ6I@zwÜœbÓX…×‹©–Tı_QÉâò«‰œ¨]$Ù{™¤W¸õBÑ‡Mq@†ÌÉŠ<¡òÔyh©B²ØùÊ÷:Ë<+Pà*Î»ÓmØ”³fb6M«dLäiib¸¼4÷j¢µ#ş¬ÿ·6qOOS$w¤-UĞ[[Òµ ,+HqŒ»ê|‡èemp´ÃÈ%L˜7Î›|H…	^ºpş—Ö'¡­÷¸fKuç»\–q:h«àÖ£>H°5n|L"ßE1Š]‚£%‚~éğY5R$ñ
”[sPî <'§ç«	
Ï µ1ºEh¶Ú(Üdñ¶úFÔ§ªĞ­ırÒ¹¢>ßê«ğ#Y3ü* äÊ®ëÒ]“¦ïÉØÎ…ôj ¡²¸Ğêğ€*+éöX<}¶FgúÓ–8¶ùÙweVkô3ãÂ¯şØŒqÍy4Íñ÷Ì.ïË/v3€,è?™öÓ‡¸YÙ€şS›i­«+\r´•¨—=0r)£oCÖÈWgíøà] úùÂ«¾”`¦{Š{ïÎ´Ìjû©£€İU¥·ûæ$×¤2˜^¯[07ì">ŠÀ“´­Lp>ñî	¬ÊĞîág6y4í€?Öcîİ°²KĞ"ì$^?fö½_?}à¤+gâón¨oĞ
ÙjvÃjjˆ·!5GÙ…Ñî¡N!”¤’«*áª›U–x)8À§JÄ~BÃëì¯–FIŸ†ßQ®5Á°Ğ€¢õĞB×`dà)•²š&ğå–#DKÉ^_Ê}ƒ$®aĞ•&zï–zˆ¢Â›&vJHÂ"W3"÷¶ßÀ"][ÇˆÔÊ¦¾ğ~ÒGvœ6ª§Æèêë¤ÀvcÒKØV²7¹^ş*,I¢&9¸ıUÜM7[=WÆ+'pï—­ºJ¦[T@ZËÍwg1HkY €ıı&}çİêqí…É Ã»¼ÿœ-+7+)§HRëê
øbËrr¤”Vgî‘€<5v×(ı»äáNÛö&‘Yú#P,7‡Æç®‡4©N&7"éæì
4Û>‚ëø-¸Lªæ&.“|q»@IÓoQ§b‘–6:«ù0Y(•ÜYd vwš²=	Zìô
ËãÑµô¾;¾TêíİÿÏÿ[eî±D³¬aÕ	EÙ îPO¸Ñ*rtJ¼6I'Ú~ş¿©YÜåÃè¥š½ÁD‚>‘À/ªéwuÕÔC-Š‰'ùª¶İñ‘HÛæ{†‚i{+¬ø>şÏĞÅˆ’ÿüS?é+ğa°8««ë9D–œº*S¬:"Í”MµD¥a(S+´>o×øƒ¿µò]¤ "ÿöï'`—‘İ`Á${°J
øK[èêhaMháÇ9r®5ñ¢2Ø4Õ”¦f¸C€û¤fÁMKÑ!”’Dx¢,=Eg,5%¶­÷‚ôÊHİÆáÕHëÖHç 1”°ƒ`46«CÇç!Ár”õ°ø/Êx!µò4Å8ÕRsãÁE¼Â.\=¢é¤'XäM?,0Mê&ËMAö•ÑÑ¿uİvøu¯5ªÉ]iD°ŠFOv§lĞBçG3Aéz2_D+ƒ?Šƒ‚V­†sñN‡O/, DéüL¨y»6p~}É×ÏQñ´EÈ ŸM¿ù1“GãûìäÁ%G.“HLÆã²ÁC”ôÕó?èF™-Ün	8ÕÍ½Ñæ~ß¤C_2 ğÈc±„X®¯Å(LaãÆÉ²§+¨ëJC”‚ï”ıı±Ãÿ¯ÙRrx\Ô€Î`Éàïr>q}ÈíÃƒê9ğéÆü¿‚Ÿ.Cpé+ÃÇ`7„!4x3U¨Træä“¯L«ˆri“¿uu‡Åm<_ˆˆ€»zšıå7³Ô+:Ÿ(í
Ês^5›CXJhrÊl¶ê¶:üyĞœA~Ú*/¤¤mÓx‚•B|¶R'®Ë·±Åş
lÆ‰ğ¿+TÚß±}òW¾æ—IÏ®}Ag 1T;«åm±+½ÒúÓ?D¼?rV®Õøª'ı»›LPÕ!M ^8¬¬º1~„n=9ÑzÓ,j–s$1ği‹œ#
±O½±.|æå}$ 3Ç @Ï,÷nœj(¤¡HÙñÿN5îúLëØ&şñF‘©ñô”æØ
t¨’ÉÍÊQç¼æ”è7SÔzŞ
‹TÎ7q=}‘¾‰µ²Fvùne¥š!N”ôe.rˆœ.'‚ƒ]ÂİHt@Çoº–jC’^eä‹¨×•Ò[h+Kˆ@œôÜË@ëz°D)DÂ5è´=yó½•û\räËÙ2ñÜZs€ş*RÀ(ÛÕ„v_-ªòè"¯7Ñ¯QĞˆ`sƒh¾Ğ¢{²Ë/9Ø¼EùæÌÏ8Çâq­Ë±Ótb3Ú9Î¬k†¼'à…ê¶Œõ!†å•ì‹Ô°äóêO¬Ëæ`»m`ÀŠSÍÏŸÉÚİF½?r?Ò{G¤ 2"¨—Ú·1‹Á¾ËÊ	 3jux(%µó·òqdn¶ ¥,˜pIjÿ+$èl¸‡¸Ç¿×C\ š·Ì™d±˜{ojóÓ®º*şkéÀüRg›\Ó[Ø€3w¢†”}û¶3iWšœàÊ^é“#y	íªÏÑ›—5qv·y›{Yò~DñàT“–ã®BøÔv¬u	Iv*Ùˆ6:y}sdJ Í5W (}“JM¤ßo°wø V¾.¹€ÉãµéÈ
èG,kÄ9yQº/’€;4é#±(Tï0³;’Î+s3M’÷áG`9ñ mÿ†­Ø¤†€.2ğW˜¤
êÔ›¬ÌÃ7Éò7¦0„Ş]Ê£XT PQ£ñÅ‡¢ÿú]£Kúó<uØıU#…VºÁAª&êÇô PõSìÈID¸)ÃÏVæßŒMWÑÁ(6·uy…{vÿØ‡~Y rbŞUè¦äÈşˆï8“#‡ò3ˆÕÜ$Ug[ĞÀ1êrºrqãF›û²³JëBÍy}eÿ‘@$2SPîk7¨D˜3ğ¢¤ğ°9YîßÄéwÊÔíq?ğ²ó°ñ2—§Õb¨’´LÓê®9uI|›˜éR×šuÇÕ×}ï8@.n«¶xy5Ş¨…ØU0m0êìûæ47…¯ÑFšK]39ÊòÇ³t†e¡;Í"6à°_%R-‡!=Ô¥ŸœşåCXÄîcèM®¼/
°‹}u1¨7À×4Yí×üŒw( N#uNúXq³ø&(“?#Jñô¸ıÈ®úN
—IœÒÛÇÁ_âø½KRöÿè¯‰ötH8¢ßR× ü;nøº4˜€?ä¦Q)Ù¨ÿÏ@·]Û)½ò>f•™YALHÏêj”;ô(`KJn5iK…„pÑÚ}
)"ÏÆ½‚,.-î‚ÖøõÀÕo2W" ¸A`)jÉ^–x¤òtO<Éo;X¸¾«mêG6zÅndà1‰ˆlfE›Ìôr7º,÷ËÚƒ{3äBE/ò¬‡ s•İÖñÓé
v¶ŸôÎÕxŒ‘ĞŸiåFÉŞYïİ×¿©y¢8øÚÆÁi’Ë8cŒ'¶RÅjº¨ÊñHJ /ÎKôCÆÿÌxåXÙfèf‘)Íh©æ¼+CâMcj,·åV	øóç8Œú›§Ûoô. sŒ>Ûi“ÓuI}ÑúFó/ŞrSiA(€ş¡ï¯®2¾ü‘=—¶¸¡¼ÈëëI«1(¹®%P0·ê‹÷}Tg°¸²ÔŒ1ÑPeRìÕ«øQïsÛªÍÉ˜9xØ¬G¦Sí¨Bdz¬BímèQÚlåÙŠ]A™÷„÷y
©LÂ¹üËyVƒ•àaİÕnß2„ÂLÔ—*b¨ŞÊã´¨…H%ÕÜŞkì1;Œ/Š[ÊïQÕ=uš¨*åK°ÑlÖ¥“Fi)_‘Ö’Äzöu†H¸¯\Šb'6H+º§i>À`×ùnâ³o&Ô¡D¾ÈÎg¬ö¬o¯ø/gn¤ Ò\¤ÕdN˜ûÖ»¡lˆFtSˆ «nüÇƒ+‹qÍì–˜íèu¯"vÛ Å}»1£dJİ´/ÔX›Wß@ş…½¥“ğL-Âx¤D3ìr¡»<úT	Mg’DLy1<û(ßl–[H–'õLA›Ö]'lÍİ´F^æZŞ‡j­ï˜hoºxYı®tğ'‘A‰ÜqÆáçéa:78À^N^oÎTİÚÅ‘7'\kwK İÜÂ7ãyÆêz X]¯(ˆ/	§døFTiüõÔøŞ22˜Fò+0‡÷§iizÓ–‚ÌÒ`6Şq½‚zclŠDÆæßÕq1èf¦|FÛÅ´œM#(Ê-K4†x ®›ÿ±…V 2áF÷³tÁ²İPŸª~Üà¯ë
«™î¿ñâmÅX1YÑ@EL ;ò-ìLŞjõÃ´³Xroulº¿p”x´)…Z]Pù@Ql~â÷1öÔu¥è?Í&P+F·ÁÖï·3‹ 3oÂÁ%;U úZiî
…~i¢xªLD’‚¡Ç-_­S¤¶!ÇóZåƒWÉzÄ™…fÈÉG·zºçÒcƒFÚ ¹;$ÚÁËØÒD‘#îmˆƒĞpÑœ‡‹ÈàQŞ…M<º×ì¼K«Õäü(õŠ’?´£ÇøÑ+Y:®(¸!í¬P±˜7ûB9›Ôö¶œ¿ı•’„:i“zvÖZ1èöH,ÑeÏBÂ¿À
1f‹Ë*Pë#´D`%›UCO]Ê–&\—Ë3>a:2‚ë£ëg³š	Rå4–µ€–î”İ§ +Éª=_¾pÑ~¤ìf5Wym6 Úàœı?·$ßdKè>KìÄxE;Z³+á ¾ë³J®´ëˆ1/w˜wÒˆœYL•:á[¿‚‡LE/ÈŒP:~–\}¯îÎ`]o»æØ*«ZhĞ¼½}±ÂèV}Ú=äqsó'ô;©(ñÖ4ÔºHî»`ª76ôòHøşB¶ ã÷Ì¡=(û®¶P¨®?½P$yÄôŠ3Şz}W’:…òß÷–ULá\rì¬ÿº*tA¢\™\,jŸkÏ¬ú ÙV>±x·D>×¾îH`†Qºí_)ŠÆuHÊÊÆØ–CÃ7RÔ’ó¦ä¶ã|L1Ü¯Éá«XpÄ——³½
&J(Ùõ#ÉN©ÃóÁÕ~à2¹Ü¥„^Ø§Œ5¨¡¯–'"TŒã44ºqWTyAÌ•¬gñ¿¦toaâÕäDÕ™I¦üÔHà’e±È°xHìak$B…¦ú3æu©ê¢Ç%ö%a`WÚêİÇ@IÊQËi9¬x40h¿¿——3s}hƒ´¶Í[ÃRwŞWÙ.ÌW NÕ‚K3İº‘Á7úĞ=ÛiëÔ(%Ö]W´ë8Ï}é€›,do¸íƒ¹fªñY§§÷_Ù¥V@¥¨@«Wp8˜ôº‘(L%ñ=j0­tß5zå£š·YôJNÄI´ï ½ºU¨ŒrÀ£ªx ½¦“Ítã K½pR0l\³=22§ L…¨¥vZ`iÑ+ùòïËZüˆ	©6O„¼Cr¸ZÓ÷/Æ+PUWdS~iî\áF•Y¨>Ó8,U^H~­±·ï*ñ]\Î…ÙŠ[ƒ@+¸ZºÃ=nùw2&¥›í;®øNBf‰LàfyâD¨N¿r—töÃO¾¯$~NtÃ‰0p˜|aû9bÖ‚ åxÎ=6ÑµÑ“µ ‹êÆ¬uüÇ’2$I€Ÿd2lÉÂ-På$‡Hº,tVi¶ù¯\:èû‚İ:ÔìÀm j.(+`z‡?*H2Û5]aprØãí‰cË)|ŞgİG|ÌõX½›6äüÜşúbcm•“±û;5aâËš ´Q&6×ã1»‘… NÎ@3=ƒ¬½¦ÅğO’åF6¬z¥s|Y­]&Z©Ö«¸2´ó.&>(©2tkÄŸm+ê1g'Íš5N¢!%ÿø¾
H©ïÑšŒÌº<Ï‰ÇX¡¿® ^pì˜Ttb_eT¦”/ô?ˆéMÎóLÜs3Y[€çî0Éœí +±DmŠV)>Rú	LRğ¨û1=A:9™ëEÉIİ.ÃzHÉ`Æ[Kj×.@–V •¾é•Êµ+·˜½”Œ—‰m+å¨Ù|«³³Õve,ª"!Ø–?wú?ûK9W'éªÅOF“Xóä2tvÂkì—H),Uµğï—ëŸü5’ÎX1¬l¬/ù\ElYV~BºÌèƒ—UŸêFÇRdu*İÓV+Fú®j
ºÕÿğî Åà ^ZŸÕİê
e 5FôkÃ–PLù?èËKymJÏ ‹œŸ„ay]Øet® ¬pÓ=vŞµòõC(+6‚j,¤@ÓÚúgÂö!Bpõ–Hö¾s¬„&NÒ‰PÚ÷vÔwš¿Zºáo|ø/%µˆ\qî:ŒÌúDM¹ª‚¥Ë´æÁ!Î-Ò÷£ş@:UX„0~§O/7NKLÒıpÙ±ó39ãS%\Oœ8ïµï­ÕPà:^M=Ù2Ú8_3©`“XûzÎAÕ°bµ¢"öñ-£û.™?Ír\Ìr¢‚Û‡xgy7Imv~+gå~—,åz-#HR 5‚J1™•/LéèºU#{÷I:p¹üçz–æ­°„Ä
QµÄ3Şí¸ïI
vúbç“À§İ»XI¶…J\\î“ìc…ææPak“ºx°Èè;?-O˜ÖÛlkS,õ¿*UmÔ|ëÑáùVşúÕ×«úªÇkí»‹¢?q¬“à:4¤B²òÉMlù‚Ï˜›~[	¯`/5âª;©¶N •oŸÔ‘s$^^ˆZ<²”çÍRzì.tJ‹€Çù+í.§ıuõ^zI€Àp+8$©ƒÈj¨¾^ÊHX© ŞPf®xÛ°xnƒ»ñÕà+ƒ(–~K.]5&¢Z•V5<Ÿf©åÌOi—UENaìŸ?ÒÉ &ßÎ¦¤ÈG*Çè{Ù.Ã	İü H×D²„*¸	WÛ´y×>fTÂldÿ®&æ„ßdd)BËèÅ€]f3ˆ98á"Ì(bâ˜/AQğ˜Ï“ıœi«9ÖÔe¨âô‰V¬)ØŒ/<Á0•¬ª¡è¯æŒ6‡·Ó»K«¡pÿ1¦tÅ¸#¬qtO¤C'?qYÃY®“Mªèd.é;¹õMR}æ”xÏŠ!r…åşÁ^o"€]Ä…•½ÊÈòî	Ş|?¤Ö·ïµuøK²ş|L í†€wá1’O¼`0¥:Z‹à<²ya<ş{D‚P‘å«V:_ˆø9E2„·9Å5•®LÇ¯hïr?ÿäÛ7N!i‰¶…ôÒâF%Ë4˜ Ö¢ó—Ò•^Rã™Ì¸ÆÃƒÀ‰5HevI}Má² mDìá…^"Î”4PS;!u8w6¯%à`éÖUd¦–1ö‚É§—ìÚ¬<¶4TÛÅ›ŸQ\Ğ¥YÓŸ´×pd`r
—ò>öñEn>EÌ—ÙÔ*¥¬
Û
ˆ}Àjux|q*Å°{Y§mE°`ZU„şâğ}59nú†P ù·şÍsı¤täe¹š(3¾Î¬ı´A{°à#ÃŞĞã TSnG~—æè0f=wÊhb„|p4³IÊ"I×¯^Š‹vÇÎÏ¶m‘ˆ6uÔë7nT¶ñï	 h§	Y¹?›ÿ½¤|:øëÅ¥Y~‹„abM(ÍGBVç§«|PŠİ)1ÖS «¿œ-6Äİé%h¸Z,>PVÆG¶ÛlİNdaÊ{ö¿ZÔ)å×¦MÁbM[§(¥³Ñ«ÑnTõKø.sYŠ<Ÿ:jm0¢2j]?Ş›­m¸GÒ|ú±`{úNØ0"Rş¶Úğ£=‰ü4ŞÎšIl&H1<¥Öš[ŸÏ"¿¶Æ’ÜÈ]i}Kæ…ô—ùao8fƒ\‹¯åÍ¥c3Qiñ¾’ƒ¨CıÀ,ÌĞv~íŸ–‚"„I1§ë	í™à´9Ü­Ù@Úã­</¢¥…S_àfQ%ôìëxÁÿ÷²p¨ÅÌ,mÂŠo­³áŞP7Å"=KR­>s0”¼ù¡ªN
Î+½©RÖ)¼JÄL¦nÕS/rÛ=ú¿>ëÿ	îàGäMlnø0PQL˜ñÍ¿~À&’Ÿ`ÓXûù [>ó63´ÁóÌ‡¸ËÌ`2í4H~jøãMbæÓù-	t‡q¾ŒjX¡ßĞpÅĞ+epÀİœ¥Ë%áëşêÓê{}>Q¬Ğ’RM®PØ ¡²ºàÙğ%´Ê+O’¸r²í™ ¢~.m„ÃÙÖ}D¸›Rzójªg‘ß¨ó?Ãd•²¸7–‚xöÙXãV2ëñ‹ÕonjşoÄ ¤ÏZ¿Ş QÌÆ›Ñ ÅuÛ³âƒ+G#¾›2¬ğ%Æ ùú’ï,(ä*ú9ÉÎT@ı®bø.mFpù¤bpÎŞ‡WÙ]	ö›„	ĞEimMtèÜù a€åC<Â2¶3SÍøG+^Ù–-]ˆm›™†ÓÊ«¹‘¢ê‘0B¨uµ}<Ï×¸üu’}ã	ãQi¸§¹^0xìÌ/µùŒ¾æ9‘Çÿ¾–zæ²VRÀŒ•æ©ù«i
JƒÕâİrÊ NQ­ñu‰êÌ£´}‚êëUc ÃÖ>â?\YÓÜ§æ87mÄ¼XªÎ†İìs“› 1Ä4ŠUpÂ[,/'vÅ1Ğ»2O¢–1 $/©’Ü ›Õ÷a_B·-jŞ“4Sù¯0‡¸	ˆÀµı€ü2(¡\Ïµ©oÅ9°Šº¦#üÑÑµD¡Æ9Õ—óÇázQîVÀ’Á ‘dÒ}ŒôlIH\9ÀÓ%‚!]Ğ‰vL´@ÅÔ¥ãS¥h	ÅTóßs‘—½[ŸÒï_Ô&Ox•T7>³ŠµF
ô‘ß!ÇÃ»×Í=¯|…Lô‹L8ìk©dbí°M<:WÜ¯è“³‹me´g$A|€ş„8/i«#½ûÜĞT·m|ã–9¿âr)S‹Â¡æ¤Ş RP ¢ì¾w5ASQ³ôYÇ=2Èo3°mŠ€({œï‘q¹	28_!ŒòˆñèËmé»íÎZÃ$eV¶ K¶ Ò¶Ú˜ïÌ½™Ésûnë_ñ8
‰¸³ôjÓ÷r–	ü`ìÿu$íÇ&6—-ÿH,{„şV»±¹ˆè~r~ÖÖb}lş˜<7G”Í_¥Ù
ˆ9ŒÔ¼…1¹Q5‹éoßüîØöTk$\tr°Êöf6°Ü¦óë¨QjÀı£zv­¨‰spau.[*|QŸ¶W&%ÍL‹ú´C³ÀO€W}áJÌÔ7.’,.×òî.WuDP¦|Ki>ı$•B8˜^šL2R’·\¦–b•4â…È‰£ê›yĞ›Ê˜SäÒ šÍÆ1Ò?œU!oj„bÉ£ZkBlÌ¡ÁœŞ0—ì¦KKV®[ £i¬ÂJõ&SpÉôI¥Ÿ–z6àTâ­Ñ¿½*™¹‘ÕpØ“rè=N.©íÀÇı€S ¹>âÖ‹=³È»}±¼¹µ^&v3u¾àUÎSÊÎûÙ!9¥plA0»zÙ6ÂøÇJ±•InE¡ş|jğœahµ9çW¾­-Ëe×åÎ2³™rîß«ÒëÕûšĞ¢&xz…Êf	*ewª+å£¥?—N¿oÇwUqV¥aRÆ5Ô'“IY’ÄïzN¼”¼¸ö’(øDÍëR"NóÛ”Êr5¢kù[Êò·è¯ù°s„şš77‰¸uËñ¶Ll¬·¤¿ı-ñ¤a¨ã&D3	û 1²Æ'UG7ÌĞ¶åóÒ™êË·~ÎÖ‹üxl]ØvmÜÊe«#Ñïs‚>sF”Ÿ”=¸¡J÷»—½7]`kõÿQUYÄ2`³÷W×_ñWo<8+G_¿Hv[b[ŸUÒDğÕ‡iÒPycÀ†¥_Jûx4Ø–`2v€IÙH@K8æ!Búú§_XfkvĞ.åŸózl©tmİóÁµ™Çoi4ZÒê<Ãô¨@²ªzù×5Í,û¾ˆ=_ıÇaŞõûˆR¬“/Ù×îÔŠ r$‘Cï lp
Ú\²¥l·“MbŸ~™iÏ¹4ñà }ãø³ÖÁA†õFïœsæë]–JÉ)•^Í?ö,Ïƒ8	©q:Ë_9ˆsÒŞ°\1¦ù×‘Êİø÷Â1º½Ëô¨8¾Î†¿Íê§Èy?åœ‰`=¼ÎÜX*ÒlŸ©å‡äOK¥Y“fø£ç®µ6Ú!¥#’ë;Œrîï¡9ƒš>«p©K4×ÌlÅ©DÖn$¼RÓîZÕŒ¿ØäxµfKcûÂÓDTvh‘B‹_®TÑ¼xğİû[Á¤DrØš>bÈÆÄE»¦ÔÃ}£#ˆï­NÊP†nÏÑÁÕÆÃG³Ï€ÈDQub!;sf»ÁØ¥ ä²áƒÇÔK!·@k÷¸µäü#Şÿ+Ü‘— ‡ÇpZ€fÍéU—Zãî^§BÃpØŸ‚Œ®%f*”>Âáw{s¯Ù'F"CgÕqÆ°Ïé3·¿oÜàQ|S'ahbÎB˜N—´ú¾áûÎl^‹İ³•<îi·Ô­û7¢i»Ë
œbÅ–15{¥Ö5\ØJ&ğÃõˆ‘¢ ËÏôl–€H:?[s“„…ìˆºtêØÂĞèíâ©Â™c[wx™~ù %"ÀCa6L0YtÌİlıPÀKè¯ö[Ô‰ï¢yŠ!€¿$ZBû:©6ÖıóášçbmmÉ*¡†í°'ÓYáÇ¿Œ;ÉD÷²–åd£ğ”˜à[|?åÄÎG[a]€œ×²9Hg¥'@Øäæ²bòRËJã`ÈánxH¶Aûšõ·Ú¾E!÷á(P#ÈÜ’¿ãU÷{[zEOF<¡ÄÇGI£§òRh¥Ò~'P<ç¹Ï[ºÎ:Ö5¿ùKÏ\Íœ2ŸO—±(	§qêvW…IİIEË <µJQ"~Sì6,,0Î7×&È5ZÒ»¼Ş÷~¶¦,sõÓ® ©¹ş€OH­y.ØoUZ~êæmÇ™ùYŒáşC`uÜ$˜ßÒ5uÇ¡é—›È P~€/óãÜµßBé?ÃÃş/Uå‘ÉçT/°°¨Ÿ¿É·l_@ãzGê$?ë˜ÄVm‚-š[ÃhëİyAmDf»8Sğ‘‡ e¥ƒg·MéT¢iHpÈ– ìñåüBeZ½(Á¤;Q­”eo˜Ê©ÂÏhRŸQ¢,‡
!ƒåUD N´Õp$Õhuã”êÎ[¨)ß¦5…'GË6ŸšÕ R½k¡€3áüoÀĞ¬¿ğ t0)IÿO`mÌFgÁÒÕù‡[o.±³Ï~óVÕxg­FÜÃÏde	ƒ±Š<]«$ïôXn”!¶l&ÃìSÌjêbË?¯RTlGDØdŞ½êÂñ#¯îß0ª|á3ñ0üyÍkª²¡öø¿ü’#" X°„OÄŒƒ}·vlû…jLˆT[ çä¥.[/V“ÂUÀø€¾må´n‡b#\+’‹9J9¬´ï1Qa²»¼×–êghÑah±à¤¹†r%À’ç›ˆ©bÏé“Æ,şÚ}q½j{m
pA XaùÑM.šÜÍ„\ÏÙè°´ş_LêP˜˜h³]³ĞŞ7•O&Q,Igµ3ïĞPCÙİP„ßß+È´5µìÒÍg4¶29Ûî˜”3zkŠ‹Ò|º#ø³Û2é»ıŸ…2áK/üf	¤î/\×…¨E_Îè¢å4Pl nıR¬­É-(µV)íã!hvä×¬Ú$Ív³û$ÉK±dÑ}öè‰WvuÅ¸rínú‹©a*Ò•‘¤|s…Ğâ>úÂÖ†2PZ`dDja eà\'2{ó[°h¬›fÖÍZ»™Ê4–T'oÍ†™Ë€gIEóO¬öE\Ñ@¶Ugb²#®÷‚pé¸Fsîi?Ç„ÀÃ×	ùF?/ÔK‡Sïwü)[r„å$*Š:Ê“¥zıİÃûËzŸ’WŞU\èùÒ#•²üb‘ÙáøÁ™o:şjt•Åjù*:a2uà
{ÄŠó$|RÄ{ß7§Jû"“¸Ç¾¥¼®T¯ßá{?cJÑå7|@qs]|ÊJŸ­6ÆƒY6Ç„œcfÎ	¦ÁÛb­“Ù[RÛA‰é…ŸÏä›¿H_­iLg£ÒÊV×ŸynƒØå+¡sÿ.â8î˜½ô*,Gúaûoòû/ø<	:C…aÂ`ŒA´ÁTaãAHnÅÎ­¨Ò¾Mş<½$ÿ™Ö)”W|ò×‹9¿kÑ§6=—÷Mµ[µ‰çÂFWåUQö‹q·—Ç#µKºÛ¬ò†6ö f!Óë€‚­0Ê—–AÃªû„b]í¾Óøœö+ÀöÅmx£¨p0«÷‹¡Åz£ mÃß\Â!’¨)œá<Ÿú/Œ6ãÖó¨¦%Åe°	ÔgïZÆ
·sHÚŠsk5sË§üÙ<Q¡óP‰à·kˆ{-NqCs^'Şÿ{˜9¬9İâk†9`ß4€ÇãŞK(ã£T¹ºÎ‡æöÑ_IÂ&JW‚_Ô„³…hú®Œ ]j„ #=Îq» êÒCµ“*(¿ßSö°Èú=8n¨æ±k!£+VÅ€=-ÈPç™v_½/5Ù#çÕÅÿ¶Å9ãÌtLÛj7o17Û—¿cZÆSKÈpFkB&£!ØILhtfÒiO±÷Ë•¼ìİ¡eˆG{I99Nz?Q¼äëçì7§ùLµ´	]î’€íø¶K«åMtØ"ñ‰)
×~B8té®EeŒ¹ü+Ï2„¿ãí4_¿¨º–¶^,Wq½=W–T{€$!ãì¾ÖRs›‘±Êøu›TŒ}¦¦~Ô:eæÀ=+9
%!7¹šîá“Çì0 ·ã°»«©¡*!öà4ÖÜù4Ö»Ÿ+…Åmørû¥“#m-¨Aá16ø¦Š8±í¯Æ»¼ œÙ.rÖ	:àn]`Ä¸M­G¥ó³ú?ú zºï`/N`\d`¶±cxÙ×¡0•:7ÊVU…ÁE_y!OlñAö¯Ü_ì‘gf*o €’%R’ÊçÙh	í`‹aÈK4Ù [d½|¬pkª¶7HNƒÂ`ØÂşê_¨,üW3)pÛl†àˆ(CûßÛú‰Ã¼à¡lbo¢µC¬&GRña‹*¬R¤ÖAGñ i÷¸á!PaÄåÖDM³%×\¼¬à”öG=-Ö·¿ª^`»Bı’™G¹¥øZ×0»æ[)C?Yà_Íü{MÂVoDÖŞäsEßÍ3ê½EdòÑ ·Üğw­ÁLİ†£H«ä~Üñé:¯ºãu¾Ú‹¥Ro‡Ó:['•Áİëzh¥*ëñøëtßš_	á€A<‰½·¿¥AóÔª¼54qF`J1–€æ(Óğ(K”“`ÂJ¯<[p´ö7üWög-?¥¦·”xu8aõê')˜0?—IÇ
rB*†»&¾é‹§Mó_[b!ş&ÌÉ&×şjL<z$	)Í•$Ç™ùxèHJ£—WLÂÕ•WçE³Æº}äZs”1w¸«êZK¶ıù§ØT¥ßüçÈ"éšIe?(Eª°?ás‚.|6|íï¹3¡ˆÍ¯‚È{)²g zÉÏyñ…ç",è·ZBP‡éeêšõ`4Ñaø7b Nq°¾>ˆø«W‚ö(½á\)È"¥b½Çÿ]ÁB}
éı„ÕÔó­Öë®Õî“°CªüÊ¬Â½¤‹‚ÁY¯;pÏiJŒ¡iÿÅ·)ÈŠ.§WÚôE‡YËº?ÓZíÇPº+È¬t^¾,—"üÖ—€I†½Ğ†ä´V(Ó8_à¤kTª¡z«ûâ©‰Í#,˜ú=°ò}@£Ô\ğs¡îÇh$ÏšÂ_RN—îa'¯O 'ÀkÏò<}ÄÌ)»ÏC»hÃwÇ@~#.5è–:Ò­+.Qøw…8ÛåÈ7¾·ÍÆéçxO/ÁRCÖ[¤²‘¾:e#Í>Í 9ïÈ…TÂuOçîÓ¡+ /%«h^Õ?¥}e|ñÙ‘.¨Zš7ô¤›dœ±«°.àÌzØ&~¬?~Zzä®XØ;Ú#hêØë/L”§hÄ`"€•Š€Õ“ü4“Öoª4HŒu¿nªd)¸dŸh—ÑPgÑÀk¨N+Ï`{bó¿ö:
)ÿM»èZÅ©pË“ ÀYe%¥'¼Š¶¦N#ìx®ĞLÚÿÓKGpºU~9ˆ~´:õA^İ$Ó²Z±&6#Ğ~hb[F?ªíÅî?'Œi´§$:ô¡
ÕtÔøCÍ9Z(bœ¤ìûGËT2$príâìA{v®È2GØoçş{/™˜u>¥JÏ…"`<Ût™‚éØôëÇuÆ÷F,ë=ÀAÒíÈá&	å…ó¥CÚòV©2ıÕ?Ø§’Y†ªB² Ö`$îåŸxÛLÕ(¨İÆqº½ŞícÅ˜÷ÙoÒ#æ>(¹ry“FsMa2V¶=ó¸åw8,Î\SËç_nÊ5Om´9»1LíÙèì‹â4¨êSóq”M­/Puı“ÆS.‚EĞ,ş4>CôÓc¤D}DêgI¬ù—Ëô™1iS2Jå±½v¯FºÂ>iÒp2jı™Ş=Nf+şP‡l
^¶Í¾]»|E<DùQA:	i ^ªh‡²wM%:‚Oğf÷Q¸¤Rilèg‡+€É¸¾!µÙğ6‰Ì&_ª5¿Vˆaæı!.öù/„æA²
˜ç7S)D"\°z€ätáâÈüîG&VİxBw”o¯7»ËX²³|5i˜¦„C”>Gâš”B9AÅ\I3y "N=ıXGÿ©1fíÙ,jÓO—vÌ°ZÎíÉêÙ{nÍ
ø8A¢V£Ÿ6êw·.Ğ&uŒ0AxûFã$fÚóÿ¿Ö»W*Ö·@¢_İ?r-U|Q’¾
	Q_|Hµø£úîë½Õ”ÛÉ&û‘2~x/ÃwøŸ•­J‚+ëóÕ¿¬Ìà£Üêc…Ì@úcN
°3åTòĞıß)ŸÙ}QaœOƒ®·Ìy±’áÇÀ MoT¿+Â2^·ÈWf—Z£½ÀìoàgÊ  5ã6’§‹Ø'9Ò]«6ŞtrGöfHhqÚí £rAÍ]µıjâ½¡ßLêµÒÎ	ÜãW$ipÌ³ëìÖø‹ÕåJ"+—$xf<],D fx-GP+g•¾z¤ šüáÁŸ…•ÓÎ@¢EÍš=k÷%Òo™¨/]>6ÍŠpê£¿úªR’.u[ÍìYPˆKä0á»eüØyJy%lÜvä,Í‘ÉÈÎŒb`Ù8s7^¬šZ3<×†õÎ(pn[¥Ç°“ƒ#(î³ıßî$c¨=K†¡Œ.“I?5£oØ§sïz|\h4KqşlCa¶#e
úm`$Bx—N!ÎJ&ßQ¡0È‰ç´ô@ÓÕª™ñmM—X<}Îş ©é¿Íâ­ä‚‘i­òşï°å™#Œ4à“şÌ†Í4E•ü‡¶rèªT
AÁ$áÜCÙYN‡ò…ÆÒ?ñ°0Í62Øxùw=øÄ´9Ñá U$BÑÀòò·ª¿kÓaü=¢™`²ÕGyhyU‡òîéÃq†|æÖ8]“8¶‹HÒ	­Nõ0áW¦f;wœâì›XA‡ö¿§ÒNõò
Ë64:Ú³üO™%eé%|ô8²õZDò-rÜú„L_Vv¬@d­›¡õ<%,À~ÆÙ	-f"8I#ew¢pêáy£ø¨I›õêma»×‰ü6„hßp #B\ñjÈbR‘ŠO1Êó7Si³Y«³šh¤Æw†šv1Í¸¿ßZ‡PõÀVñyC&®õ	íd†j>4‚`mâ²¶¹qú—³jÃûÏÒ‰yÛ–0ƒ„ÙºNÙuo¦÷hüs%Ş+ËƒÙÚóß¡ÍìÁ*SÄ]Ğ¹ ùŒîIé« ¨<.KÉ}*Q¦½ü¢åÿ>Šš›ï†ÕpnòÇ?W_ĞÈ{hf°€=èu8õÖJ/%Ièôi3ù%‡Ø8‡¢ösHÂI³›KÁyLôhK“PìÈ¸×Ñ¾óŸÖ;,½ƒ¤`»¿gÊºa?`gUP‹qõºÇOµ<Çk?Œ™1X»Ä³vRÀo5f'¿Ãp`xA‹‡ëbó óÈoï`Ã¶­	¤ñÓ$RÇóxØ¬Yiüâ·Àa±-Ë,^˜–;3Qâ=©Şkî¬¦A‹Jç2Ë{™%ãË–§fm¥n>+šJ€£¯\KPë@§ŒBY"°Ì\xTIùGÊ§–<sWf‘mÏğ«7…ÿ–û¬R”ÇÏùf¯§ZXñSâš±[jçó1W¡ğ£ÆFs¿¡‘IÄB§6Şã°Ğh·t@sâØÎÙ|ù¼$yëÿ~EŞ6=Á£Râş—fÜ @‡€ØÛïÊ»«L³¶Ë Àcâ«ßK:ôÎ¾–q‘‡~±ÇP(îL(’ße¦ºF,MÛLMÓçñcŒZ–İ_!fÓd†€	U+±eš‘)ãÅE<poOü/+h)ÎˆÎ>óõÍAô¦2UF`PCşZ6ˆŞ6y[™Â­~¾d­e±æ¡èz¢ìMà=f¤zšHõ˜‡È[:¯^Å©XÒ(	È=¯œÏÀ®ŞÀR$¼¢Ï±ª‡ëBw¹´#‡â)Ècòja$k­×ø¯Ö“\d’c²méÖö—wréO?	 y(Nú	9 Á> ØÑBÜA„È–ƒÓûê°áĞÑY™Ñ']ã[S#ÁvÍ1L-E ™·J
Î0G§ÓÜ.áÊúañô%¹Æš¶Êu¹­ôª~5E6-Õwêx“şQ–SAt‰†·B|¯Ñh±‡ôğ•ìÎÕäêº=°«¾Jƒx·Î»ªL³ìå9lÏ>‡–<ŒÈ´,gÆş#l¸	°Š&±òâ“T)¨m8ñúF	ºqŒÍ™éAleâáˆúgØ}JÖĞ ¨ á×| —˜_ôÌÃéİÄ­Ğ×nîjÃ–/Ú ÏDTæÔ2cL±)â5ÈtjÍ5`'ıÿO:ÅÊDÔ1kkpíÏ	¶Â2ìH!A`Ÿä·AŞ'›ŞÏ\{ê‰¯\2İ x’©¡NíÇ²”-›_›J'S-ÿ^Q®H³-Sı8Îïä‡Š’j5zåÿQ~ZŠÃ_eµÆ¥·¹ìÛf‰Ì5¢q·Ç›´ÊÑÓÛ­{i5ã‹D>&P1™Ôg­ÚTEäcåÎå¾÷é…ÈÉµ´ÈŞšÒù»^	gªsqŸP–9!„JŠ`éJ ÜUÙ›Û\ûÖ÷KbS›Ò ½%¸eÔ‡·N,N'FXÕIæ!ck®÷òéGQx¿UŞ ”µ2}Ôú™fyøøQ•­Æÿæ°HLâN©D%RM›f„–Ka‰å©‘{…½t\MµÓúÿN~}ßóYÇ!rØP ¥.éko¬FŞ÷zBüczÃo]9Dïl£Õ™-İLËéF˜§Ëôtı—5­z‰Lƒ{økĞğÇ€Ü}õà·am€rpô¾z‹­	¯EqÌx3ùQÛ#bRÅ[£İyÌ6-½·OA²û;ñø|ÖøO-íç)ıtÒâ­èNJàï#¹’Í³=CˆõÛ.7¸dÆ§ØÍq|cy*QßD4ÊWZÃ³v¼EÎIá[r)EnşÓ¾]©œB^3‰™b/ÓŠH¹
¥½×«Î»éˆÁŠ4• HğB^+f”×¡|‹"4«æ„ÓXI±š¸©¡şê‘€dàúù¹»—c²iøÏë¯4«odÅå¿ J´ıîsfÀÀ›STDeÀĞÎÆØø PºÆ¢ôZjÓ¹…	Â¿ûğRpX)\8›ù‚¨	ğvÊUŸäFw.r­µ'ó qDU™ºÛ’am>ñŒŞ!¦ä{aĞÓ¨ÍirF;¾|O~Ã­H: auSèM8cÃ„C§Ï&kº•Tb®r¶Ÿ‹€>q'·çĞ¡cçh	v¹Á'Ô;hÜ›#ÎóÃòÄ®„`‘ßYïç]p‹•e~o²<ø”ØDõÏ¹Ó½7W9®Ùhº1¢JL5äÔüáşÁõ‚zéõYº^å»¹¹w¬M’¢çdÿŠé©YL €aFYe2šb‘pèÖ^)MÍÙ½&vt)­…¨#‡TÂ™œjÔnşÁÅİó–(u£&Ó:'Ÿ«ù+0°ŸÒw÷@FÑíÖO®"Üğ4Æcˆ'î}aR«&'‚ƒœº:,„Àƒ`Ú´œh¡ó4–Y‡šAª7é>t–ùi&Êÿ°•h{³$üÔ”q+åïÖ	ËÅª­Hö|öÜæÚ•B>/pP>¾MèÆİr\Åİèt9hoÚş„Y—±¦lf/& ÿûŠéˆ0ÃºÌ=)îÇ~®~²ÔÒoŞàÍÜ¹öS´³s¨ÿåŠßšÓâ;t/‚0WÛ5 TbU&S+Ò.ñ€1RüÊÆ¨¦‚°Äë¶&µZÜs¾As%úØBÅV# ü¶T”ÊS(sì•ö¥é$†vÍöı„¦I½„…Á¤\×üdô• 2…/Ævû“YŠyNµè‹eÆ¹RX¯¥¼^vşºtdè¿¦µ@¦äZ)Pğ=æªâ²x¨\‘qÍ×«ííDÓœ%ÜÙÓbY¼Ù£Ñ^(²0FÀƒ1¤\zĞ4êJ±Ç3Ú¿‚z[şd„@5ÂIb€btRVm‡×V«İëés´ŠÉ#µ’ÇÈ'))`‹{0ò0ÿ‰¢9Æç’²›ÿ·¸1ËÅs®)ğ'åâ\ö¤#éAğ•ç·­IFJ¹—i×®™•Î7oWÿ³ÂË)l¯–JêÿFz{ ©âÿç`Ó:nÖø ”°O8R$eV†'aï¤cœ²:-›|ql%k{»ıGoƒ˜ª¼œIÙ<«@9N^v&–dì²lEİœãN’¸øÚÀ…0	=Ó†ˆXCEø	4›úÊ¯ÊrÔ‚ñÎgş¹:'q.6Zá} Œ“I¶8Ş¨q0GY`zH½á7¦Ğî¾µ²mÅ¿ºk§”¶‚X£’¿Öe®î÷Â¸œt4Ç%Ë:c99dŸ§á/ì´CùMáëFVF0×c(%„µ{†•yº–+/öÌŠó€}¦G4ËÒBñU;Q.CÎ3Æ”w½Áƒ/ÄÁeÒ0Pt–UŒ]#v,úL .»ºwıZ,_u´ZáÈõ!jzö:ß,SƒÏè}k²1Ï®#¸¾ñì'Ír`é6Óø#ş/uÖ½3˜ìïŒ4Ñ5ÿ·B„‚åGH ¨R5#fıO;Ğ ÆĞô»U»9È2]g²Ö!‹Û¬ùíCKQ&øp‹!r„åR4yÔßÁ{o¤	K¾—"w—\ódP+j]dc™ÓÌˆ õàL>ÆÓt'‚‰I… ²­ìæ·™õUğ³¸¬ù±{Š•î/ÛÊ=rıØ^É¬Ö¶y|N.“’)</ÜpD«h \ãÂEô3Ó_Á®øÎóÉ£ä2ˆtd¡a#îË¼(‚’×ÙO¡˜›¼Ù¼´lJw’Å@îÅ/Y-W"¥á˜õ¥Ş_ñx\á7Ÿs£ØNÇ_ABIl×«;oé±âhó[—83@l“î_àé§ÓÁ[A7l#CúL‹i2c±»İ„·ëµo5ôƒçoµgäoOZÚËZ\vRİğ">¼ë_RüÛÒø ä(ÊiÔéqıÛA¦g¶çöØxa<qš¦ú„âCã?—ä~Ó­ƒ](®²Ø1ü…çòªô€/« #Şœ{?µ:kş®¥º”‘—¿Œ¹ÊMÃéÌŠ—M…E¦ı2V:‹¥¤x5¥^ïí‰7·”µ(òƒwÚcdÎ+ƒš8èºKï'ÎÑ$lØ	ùÒvX àÂ¨Z~­U§	«ÍÏ-t±Â<çš,ñ°Xƒ•Ÿ‘òØ_¯%¨Üáj ŒBíÌÈ¤š}éĞÅ¡ï(€ïÙ˜÷Ÿ
·óªèúÏl3Çtrˆ×ŠËA¢üKÀv><©8Œ\31¯N°RŒ #æ%çÆ6‹ÀQ,>²X«Ûù’2½9ÑMU-óiÍ7a`½wƒ$l0Ö4iv6‰cÓ,Ì0|6ŠœØ{”L+1›3E)ŠƒT). ¡È–Tä4p‡²Još óPÃç;$¿’M˜G¡¤"ÚÄ‹M|õùjUŒ€L•ÏB¾“ĞêˆÄ_iâ¹|ijéÜcwáX§m]²ÈÕ{ïÏ…”ˆ/8éï–¸úOQ¦ ÜHóêï
¾ï¤˜"¹<³jÎ85E‰E"Je>¹m¬
+— Ò5HÀ2¦Sàõşbøõï./ŠëmÊ`]RÔ	h1ıŠcÏü^Ê±ã-ÏVáÚ¡;°S‰óE®‚QÊš
İ¨Õ/½R«Ù(ë¦Sl  êæØ­
A£Ï1‰ö˜ƒ÷ÍæÄT|½AİÑåÃÅÌVX¬ÔojCË…›—äãŒ„Mõ¹ö‰Mû/¢s–n<èÌ	-¬Hê‹0ı#Ş´øóÀN<‰ × Í~JĞfVİÊ¡ø[f÷…ókhTîØsVà‰G¼¨Üã-Ú:­/p¸­:àİr+ÓJFTBĞ²P?¯é¯©À¢ø ¶^µ[)	èäšÒ4ÇŸ”m7Œ•ZØúÚ*)å7÷™£>Î¹÷øÔpÍˆ·¡läpÊtĞAï<~IE…æMj<§ˆ)œñâó*>‡ÃMÛ’j¤D5Ö,Ì´ËoCÇ7uĞfÎ‰ˆe1T»Ò"òPŞ4Pî…f
¸¤ë£Ï½}Z ´ê•QÑŸƒaÉ]ş†—ôö—Í-È:wwğ	:â¼ƒ*ˆNÿŞÂÆ-³+J6˜ŒŠpNßá†ÁR‚,áâëôÌ]ÆıæY³Ç9ÉBd…å°ëBÍí‘@›å\¨3#ÒsfÜæ2¤¢¾¨¾º–1ß³<Ò×OTIo¾ˆÒ.®hÛ¿ns'|™Ç.)ÿ¥‹˜*›2Ÿ'(2RÑlunÉK,÷!\*|Rõ¹‚G˜qÌ;¥rTD&`L5í­Œ^‹aÄqêÜSe«c²ÁÄÃÜcÃ+øUªº3Ì.}ˆáWû(†«Ä0Š;ÑKHİ<4„å7BoÀhZDÁ&Aæ1«—ì3œñäO~\ÔÄ,ƒëŞø•ÕhhâkrW=2.éç…÷]œ2g…QI„¦Ïè#pèÇ&oeëMm£ş(vê^á¹.ÅOs«æ’±PÚé{ßlGr8â»Àˆşö%D*Ù®õï‹§ßf‡+ŒIÀ‘«ÿËk¢—¦~q;Ò‚oÁáŒA…ÇM>I˜ğŠìıL}vBh ·œJiÒ÷2õ#®Å-néMWKİ5µj:» \›ÈŸRî
Ñöêê&0Š1Æ Q#‚ÃÕVŠQÏ™“²ÔÙ¼—[ÇÄâº(“…¿!Ú`Å…¡/šÊÇ˜î³	Ã`ßÕµÈ,Œ—Èú,j›{x…(¯3~“‘b—j…¬±¡RLüVRï’<Ø­Øö;|]>ï;!pH'×Òc‹ó©â†O¾DZ-:^{(z}lñ[‡n¾OæL0*iK¾=‹äsüÈŸEÉdHcŠl£´fW5Èlû·á0ª &ñx/1dOñİˆÎƒÁ7´äïZc õÕ%ß¥É§ªü÷3ëMëÀºÜÂiÉ(‡_¬?ıiõ ØÏ,á©³æióY6o‹»ôÌöXyòëöáhœM¦åpæM(´¾C¹“ĞMüÆ…MQå§û=öW?…jR¯ÜÈl‹ö˜$}æQ[ßQ_¢!OÁlºZå•~êÛ[–kÙml˜+& v4®Y'á§ ò¢Š7¥}ûÅÉäÛù‹2`º£ÙÑâU	G£@Ú0€Å‡<B¢BcriorŒ!³}ı‡6â4g‰*[M_ñÄæyæ})5®ÊÜÅ5©Ö_É¨TÕ´ É .î²?b\$/…ÏoÎâR¼h¶r«Èƒò
gÂ1şÇ4ìI,Ğš©©iê<ŠÕ²–VO“,‰ï-•!©z‹ğn…¹Æ¥t@ÓÌVO½¸ˆº¹u@àlí2E,ÛÿÊÇ>„K¼³€ÿ
ï¾¨’ZÃPC×+[ƒÆ6
KªXW~—¨‚¼$’{U‚üÉ’+• V‘ä¾À‡ìôÖíƒÑ<g27ÕY4[..d	7ÜttÃfaëÑl«E_\;÷j›ş ]Åe*ªGåÙŠÇå ·dJOo²`0†7gW*ÂûO”¡…û{#ºÄ>ª@3$°€§€"‘U|u MÃuì¡f écÀcbë:Âã&ónø˜“?³¾iªã¨ac]$EßäÚ¾¯†ÌoLUÆ;‘±´¡Á"(£³
mSõÊZSÜA¿Í¤§³g`dıfØ‡QÇoİ˜ÿÎJ™>­ò£¯»@šf~İıkÅ¯ß£‚k¼ëœîf,åĞW8z_¼íßÊÊÙ™)QğEü)¼¬­<fTV*%¹Ğe¥‡VóéïGŠà¥?ÍŞ8Œ9ñ³mÅzø–¤ø¶°Xëm©ü‚j<ˆ=wff4²i²©/+Mûd³7:ÑdxR]&¸
áXê…Æ§dëI‹
$•w²ª^€–°)íì\VK)fŞ—Aê¥òytÚ0âOûËZú¥ªûmäU*ğü­C£Â[w¥ÔoÉÀ¢0'SÏ§ÁÊµYßKöy¦V5Ë{İÉN¾HveÒ¥ø;«Ì^½µFä£“?Şÿ,	4ër&Ò_§ Î§•‘±ñäŒ}—M§í­“SÏEE«¿ˆÙvZŸ?÷4oÌœ!0D÷$R_A„"h¿¶â‚ßi2tlïœÊH¯)ßov›Î sï‚L»av€(kNUÙE^‚éjª“dÛÁÎ[‡'Q	Õ¦&´¾ò”[šÎ7éc›AªøáŠ§ûLjûF3QÈÒÈ¶š—˜gùVgSõŞĞŒP2t3®Ã¦EX†]=GeLç`>*E›y$¶/8kj~¦7Ï÷"õ¨ùdYüáŸøóaX¶nõ–ÕØ(MŞã2ÔDúBÁEâ¿^»P™yì“mË°ú=JmˆÔ+*´m¾Ö[¸uuÔbÈrø.HsÍ‰=ÚíÜÿZœ“'ŸX-1MĞªÎ³sm‚uáõ ©× øj(T°ğ=İ™šU¤D¤¢LĞG(®ÛÏŸ}û:û\ÎC×>Æ‚ìã{\Z4¨éR²Õ~
îjI}'»\¦Ñ=0Ås+ÚÃqİÈAÑOmQ)ìµp½õ?¿ùíw¿Qãv±àˆª²Mv˜§ôAòJ/C¸•_X0Í]ÂYËSï0SS]uÂ*Ş‹ÉB&ï¡‰9\XHŒ`X¨[ØdÒ;åu¹ÿ£7Q®ˆqĞ8²Y¢¶ÌÕ,#jÀË‘X„ØJ€8¬åÓ&nSô¬8DâjcşìöEµÏ^ºş {.Ù³üƒÀqĞ?Š¯ÎÓÆCšÔ„šàhø‘O‡<ÑHøõëë}ƒès±¡A.D›ª–€,€ £aHÃê¥õ+™à	>Ë¸âÜJ–QÒUÊJÖ¾Ä
¹Cæƒá—FÀªè»ÛÄG³>w¢=
Õá‘k—³hªz`Â"uúĞdØå¦n§/NºˆsRbs™…D•é)Š5É“á=}gd“py§İ¦©Ù$?üê>¾~Ì½ø1V¦¨xq‡³+ıUJÎ7ÉI½Ñ³W5zÂ÷—íš§–|ÁN»}±µæúDıq©fp==MØ›>HºÅ½˜UôŞÑ÷”¹y%.7CJ¸7›gî=°ºŞd`V=n¬­¯—tgmÄ'¥PÆ-¼MİCLGq–åyj=æÌ¤gæÜ¬Äæ1 ÀƒøG±¨ ^“÷4¾8gıHsò*=ƒybG´½j×#Øı‡áÊ§ëÎ±Æ’šwó“[2¥Sãv>K®»´ê’xİÃë$Å÷‘-ï¹¶Â"+*X¼<¥ë)|W×ÔÉ¦Ş\ıôL,Ešâ4—y}ÃãßË.»dBåsU]'øk~”}n×‰º^Ú$;5[œg48×aabU¤e‡Š`_M•œTÄËEà|äL­¸v/³ä"Cyõˆx‡ßÙùSè¯İÁŒ¹]šÀN™J±3Ø%I¨N6s|_’Wò4Æ~8kˆXQ›+[Œ¯•uö£–o]7û_ö´o×«èHo’øz„”[£¥DoÎ¢ïùêú!a®¥‘«Øx²·LL‰YEJá-3†<J* k²¯jˆ=tDí{]wP¾"Úq¦°2ƒºŸmKø'¦ŸO½¸!y\”Ÿ-<ÓD!9ã.$*ƒ-¹Ú¤Î{½À‡Z£dV
MyÃÆxê,jP—İ×Ù[¾¬Ô²Á\=ÓŸè-|˜€É‹qÈ 'm:?¸ç¦e?NE¦t¯B9vˆÕo\Ş›Z˜j¶}‘L/*]Ç|¿*¬+[CgàL¶IcGš rºOõ~8V¿¨w@)²¥±”ciûBü¾_Ñ£ p|V±›€õÍ^º5ÒrÃ€tÆ9¡€ˆíäÔA5D@½.GiÇÛµäE7¨Bİ.Ú=†‹ÛsÙã°mê÷ŒŞ"vß*%}-d~¹´²‘30‘¯Õlå¢{‹-µ*	ˆUÿO%ÃÌÕŞĞ}p/ÌıŸã+,‡Àbb'wGÚi¤÷éØLhL›†™>A—ñ³s‡”£·^ö#Rdï?äu­ŒÔ©uÑ_kï^w\æºoIDØ‡ŸÖıÅWÊı£ÜƒåqºP	g˜tõòsP®moó–± eB ñBu¿)NAk|9½Û ©Ú»P‚€q íJ4·–å´s‡ÃâêÅ8˜U>Ÿ_¶¼’’Ú€Ö…–ö„ÙÑ&¶%†¦ıù¢Ç{Œv»9m•ëøÍ~Øù˜W[Ê?zùÉ¬uxØõ®.Ğçí'£€7ğÑàÑ’™¦Õa5%‚€soƒ–âÖÈS3¶í§ƒÖ4N¬;;Ïb3Ê·u„vêöû–h‚±Çâf[ı¶u÷·†Û,T0YCíÙ¦Ÿà4‡ÙƒZp#8Ššãóe™!‰os•ıßêûz;¸ÇLA=f­%ÎªÊ‚¿]ç™(J§Ë4]™ñÃ:4³"*Ğšr‡Owà‡²T¾AtGÙ]êè§Ã
5‚1PQé†«kO4ŒÚO›õTş~’„™Ûe×_µÏÓ!kï¥&bu^°„p¢}î%Ö†“˜5ù	Ï™ä‰-¯³-A1…Ñ‡äˆA á™A^'c9ªÅC+¡ïe‰— pŒj—.Rš ,øÕÆæ=Àì èÉ¡_–Ú•¸‹qärCĞr,vçó–oø£î2ˆ)Xà|s<¿b/Ùa¢æÅÌÑ€r°¶dÊ:UkF€ó#é—±èçP§ù«fC²EÚ·\ÓÇvP±\Ö´¦\s®ß>úb®˜ô‚ Ó<y^9€W)PÖÉx¢`9P£3>ôûG&¾8òb‡øÛ«:<cb5&)‚Ê(Yí0/Zél*&lSçNî¿Òıòyx‘ë8¾¡Ò®%W_ÛwŠ÷W˜N/|?Òö¿Í9Îxİˆ°OWĞŒŞ5©¢@ÿ×Z^€Æ)Ÿ|†›˜iÓRšGøÎä8qDÀûFÜvc¾ÑMî‡Ç‚Æóñ|»WÏPs°ğÑkXTĞ-“pı•ÿ<Ş5zÌhT:‰‘ˆİ h¾ÛL¯µó„V<ä~Íb:EGŸì ¼ÀL„ÔÃ`Òë]ÃB:HğÒ‹„Z™VçU	kï‰0RÊ¦>øİô‡avÇ$Äüš½º½ÛR4° !Gö<Î£+h•,µ»e¨X&[ñÚaàæGBÓßŞIì•'@\C»Ö‹”i4ÀL¸˜Ö„:•M–Êó·ïÊ¿êÀéBùK@ïÆ;ÛL™|/[·.eğ,cH4	ŞOµ~œ¥qU_Å©	3Ik«0Òºğo1Qvë0è-öXx ¶n®P5NÇl¯8ø1—ƒÎ×’†d,Ñ4Å¦MİïÜ§£“ıÚø³ÂÒfşkx¿J¿Ù÷s=d¢aÍC•ÓgÚM;óĞÆSjØ²Üª½ó•¿kõÛz
ÊÀxÉ8#ü5ä­&Ë<GˆÔl²¡¥³³s#!»’5Œ¥ÎäØgCãn8³·óekpé­
ó¦˜7©¼Âu/ûSi!K×‡tŠMnsrU¸Û@úµ–#•q&^¹5®h¿`?Ë{;şrù¯|ìéÑgcùFÊØHà¼™™ÖjV° ›V×QFé°’ÙæĞ=¬npzÉlèä>ƒ,çbgš¤«1÷õ)«{¶ùŠé
ıÄ ©)‰Â]—iÀ-—9›‡$? ˆâï¦$âƒÕ‡{w¼=G™¾¦ÏæÆ³CÑêgsóÍî^×ãZP¸ØG~¼™ÚŠ¼´äİòï…§è650dNä½rÀ‚½+–éò:'	Éyn\àHñúÛÀH¨;¼ÂÈ­Šôº{¢$Ğ!~$ÚJôbMKì0éM:@}Fç”PoGRëÊ>‹`K.î¯ä‘K(šWtœúÆ.æÀÜz"¸Ê§)ãX¬2{}*çìKó>TİÛÀA®2âIâŒû‹y´ô’ŒÆ=*÷ĞáDX~3¢—l/Í¼¨©8'}Ëíª sÒêK; m¼ºö'ÛPm>7%Ò$Ÿy40 (ÉäB¸Y¯BÚÃ_èOw7‚ßª«:şµU»X¡âåN§ö&æûÍÆ´0*ØÜO†–3Vöë[½õ·ÉÛ{ö;ú•ÅÒ;Øü'>¥¤e¨íîû…Ø"èYÃ[d\¹8Zéãş0Ä„d†Ëb–YL"´Å9”³ªÒ×?^íınÆ¸, œt¨©…óó©¾x=*Ï'wÌcä
ÃFèR@ÊsxÜë{G5DÏ½~µDJï©}´=ñ;á–¼Ÿ*‘°F]š@ó@3,ãtÓ¶Ò~% ÃŒ»„x^(ÔSMø­ëñJÇ:…Bª9§EzŠa†oOlU™®Ì]ü»eâÈ:+b¹¥ì,%›ÜÏDÒl~8f„=¼†E…
ù»(\7ŞÁ3ôj&aó|$”â)Ù4>Bö8>˜3ç¿ô¸o¯:¼ØHœ]Sá)Ä°¾Rlº_ÀşŞoÑøÍ ífO­=ªlJ$Q²wÛ	È‡4ıÀ|‘Lßy«Á®£"j½1*Ş•'Ô&ê5€°h.`¢zå÷ÅØ‰…ÍŒCñ{…YV*‡h½.CeùîNÔ[3Şğµ(wWãTŞ®›$ÆàM9S‹ít Â>U]¾ªJYÌÊ”›€½y¯½³KÀŠü{ı‚ÅLw4aG9Ì*¹>2x]¶»›
¼»ÅĞb,Tày^R™~/D"ôC»*jx…½G^h’‘¯‘åJkx¬V®¤Z%ÿkŠÜµ¹ş>^¬º‚„-Q6 ¦üÙWvŠ©êe½m‰³çÉúä«@øQM`h—?©ïò06o¼U£¹êÁ !6Ìü+kâÔ”‚Kôğ+Jø? …£İâÌ]'ªŸ‚ÏtÑÊÚû|;ÀljÊG*)ïšÏ;êæ]hÀ,pJ‹Â–EÏÑ—İL3£<Í.Äa_•5eÇ­³ ĞqÓ÷‹Îô~B¬¨ò‹µù…·—:ø'ËDŠ—B£éGSÒ1ûîMªVô†é¨¦KÊ=‘ïšùvÂ?÷m¾E[ ë’ğ ²Úä»e–ß×(A|_T-ÿÁÆëë,Í1Â1ñ¹>ßIYLòµb/¤-‘¾pœy§ø˜wo‡TŠ Ïı‹ÿ ÌuˆCR5š÷éL[ŞÅ=Á0U/˜(z(VêßŒÄ*S¨N¼ãĞ¸Í,³l›¤ š”ùï+ù:õzVŒ/œLºåc)Ë^ó<2ıùê”B™)°	´o´P“å#éàÅ‘‡=£·€"QUDã_QQ¯m­zá£À‚kà)gÛùGµÙ·r!šÚrš§›åU ácæ²@eâì0]Ë²)8Ğ
8OÕ”ÖÌ€¨,0øP"HˆÔÌAœî!ºÜ—(÷eCSÒS·ÆE6 ¯Ï'¨ù6Ê! ¿x‚<ûM‡±¹rü/[ ¿8¯dªYCÅ´X˜Âğz•’o¾_I*Ùßâ”ç×ÕÁÓî´©×"‹)İtnRÅ½Ò”:U÷è¤Y¾ÔÀïOÿêŸf%‚m±†Ä>àÁIºÊŠÑÕ‰xÓ&o.­²¡(×DƒüLçyĞ;œTW®ÀU+
Ô¹®˜#r\Ì¶ÌMJ3o9„P§0İ‰ğ·€å^~ZÔ½wÃ_È–RËNtÚE‘Â<‡	«jm @”€óuö·ÄYĞpsŞºR˜ÑE¹Í]›2'0kGı×}ñTK­c?/÷ ˆØ+I;òa [òm4cN7mym«Wõ‡Êæ¥ØÌÉg$+w3/‰¢A~ßpYÄĞY#u²}	Óo×ÿ´‡u©d`²*§ú³Ùx/fë¹vªNXÿş?YEä.šå–^Zp¿v4—?Ú¶ÃÖ~T8ëù¾QtÌ«äÆ‚ó°âkÉèãƒš|‹w¦‘ Ú…ƒwX%y¿A¸ÏYB±w˜@Kù5á†(iÏ-=›ÉÀrÍ©G{óiŸiªÍ®T¹¡Îã5$mäx Şè]bÖc|‹X²‰$â!İÏÛû¼Yº±’.WúÃSÙ˜àmvGÆî‹f)Ç$·&ŸƒÑ	tNc@ï£†øèÒ}q°lJ!–ègö7Ä7›¾†åšë8Ä Ü,kc6]¨ê •=ÖâFF¼Š÷|5Èm?áï—XLñ<:Èd€¯6˜¥HA-"X5*rÎñï	%a«®Îg¶eë¾Säî¥&yÎå—V>O÷d=%åx”Ò|Ã¹òš±|”¬4lZ84ÖæZ{œ™<b2ùãs#ı½qş.{cK‚¶/êJ¾¢uT‰´§vÚÇbÓ šÑ1î›4ñ¼b`ıMª‘3Àû´ƒ ‹ÅòÔéİ’ÀF ¾~ô„¥¸:œ46|+D«8ú‡U`µŒ® A½¼‹´ÏGµ£±èÁÌk$±P@£ÿQñÀ7O"®ˆ AlÅ¼A…éWÊM½ÜÖ>nêîr³ß§«Ğ£b¶«»ä;Š[x³q|Rûxf¨ àpn-r“ä[—,ÜCÃÊe@ÉµÖƒğÉ´„NøO>‘ğtÒèpÅ_‡a >\[M	]Õöì“é‡	º“‘ ä¹K×v¥tÙq¢“êQ6z#òi{>•OÔ§C×Vø<É&xRØÎîÃ¦@pÏjZò`ƒöùåõşE|Ğş§E<»ùª ¥ım¿x°D:‚)Å¯ú€eÅw5”,Ø®0*§ø“P¡Écs{şŠ|Ù2¿oõ>šËÕ¬.(QÁU¹_+¬hC>ùRì¤û ïdTëØmB^ÚÑ¬í¢Ãà¦.Ô|bAa¥¥«	1Ë”¶]<CWÚM—èX;·ìİøí Ÿñ¹'@ ”Õ°r€%îÖ‚%vıÒ¼™i˜™Ö:38\5sNícéæĞ
y’°^æ•OíxOÕ$ê´ìdæ3DA‚¨ÍÍ†ÿäœ4‘`´8ä(Àw×ˆ3Ï!¶Xå¥¾Âm«èî ³µövf{ğÌ„yğú ègÇÊ¹Êû|Á<&¹"k÷ğ§Ä`Í¹ñç<ñ»ji-=%ï³Ø†Y¿òo.”m‡P‘|HuL’ğ‹â“e%ÊÔ9QÇÚLàz±™¿D)Ê1«Dd¿ˆ+“uoêDcj*oU­æO1Ü\À›ĞS®´ËREg1=ikîõ&Dì÷ákí’oĞíìâÉŠa™õ;Jío²©Iœ#§¼&[–
W•Úw«s‹=¾€Y,øn{¬äõ¶ÑM¸?ÜK££<ÑXûÆ‰..® ûËÈ×'ùÓPµŸë¸Â±3âUØfy£ÊT„cl2¬—ç$PgÛò8n”°ãmç¦›À÷Åh¨L>Wán‡»TÖ1@®ˆ¥;ÃcnYocóJO•_„m2,ãÿÿ{í:¬d)é+¨nğìdü1Ş–^È_‚ĞY	ŠØ`?©¯^Dk[Ã·Ê@¹ñ7êªMç¾ÑÅóÕjdàğ¶¾-wú}^uÙiiÜàÁÀ¬äL;ˆ-øı€˜ÑuÈ‚3$7B¯¼Â©cÍ±}êú«<œkÊàİç/$3&¼åv7
ÅÀÉÑyúhJ:™j6dK™£¯+0‹S<ÙM‰ü~` Áäÿå@êYdöñ?<i`÷)HŸ®ÇsºŠô,ÌÙ²vi* ôW:İ
¸8zã|#(0³Ú¹Âğ’Ë³æÀ|GÈa5}2AZnUúÿù0Í]MÄ(Q>·@¿3Õmœ#8P(õÜïX{¼4B¬f³}ïÈ¤ùiÖö*Ô¤Ö^ÄÁÉB;3º³ÂjÃ„.ª`^{ˆ…=„C²ÒĞ{Áç:§Õ!W®Œ¢†¡›R´ŞË9MS:j·t[1rÛ Õ¡4yz}"ë>İ#šnÔ•@Âü\ª)p€m†0íº4³OÄÎ¤i
Dîü©¤˜A?äêİKÂÃ x'7}¼Eï’V¯éj‘Š	0±‚ÑéûáGîâÍÖÒÓ	’çî\:Q'í#qøÿÕ{x¥å¢4#—ô;A™Ç‚àF¥E’{N“ W‰~¨_À›ĞÂŒa!úG©‹ÈÊüÀ~…‡(µR¦û¹i‡R?\+3æo–+ˆónP´Ü ŒƒëñÀ­ÌÑ€g¤bí@è‘#:{ÏF»}¸7¤_™ØVOØ¡ÍMAúMZ·ßLŸùzòÆxïH£³u±WàÄ¦.À¦pLYR¼Éñ>7ÓM3ìOÊ	kFlÕ¥&ˆ‰<…’€İìu2«Ğ'¦Zqî7	ìÄÛXñ’
“GöïôÍIò^x”İUc`™”´ë7ˆ>û²—æ;¨ˆ)Q$ÄL†zìæpw¦¨}Qó±Ë;˜±j;éeËÄ'å€5ñåÀ?8Ç¬5b>j(£‡X3–òÀNE´•anü–ÿ*X{£úÂ!Ë“dg”}¡ÿK3J§~K7ó˜}£Rf«A\PÙ‚mL¨r„Ö–½Hb«³şûŞªxúŞofGş"ƒÕâRª!H¨Eúrİâ`ÇÊÑgñ)oyË{tT:”­@úX™o(.‹£ÒÃš•vƒ^ÄÄÖßë`clƒî€æ€ó‘¾mòòšn©ÿÊòl}Mx¡£˜iY¢}É‚t¥Ü®§!<£+û'=}Ó¿:Kø„ûQf€%Wú&tOS÷>oß=ø¾±q+:²6¬–·àš%”İhÔ
òpdØÖi¶×ëALD—óƒ1äEŸ©ƒÆü2DÈDÿ{Vj¡„ÕÃô¶ÇHÒÎ$r]½ŸøÕÑ¡@J	ÎUßpƒéÙğ#õ"5/G°!ÆİéœVùdÀ,º¹s†Õ).t«-ßİuÁ’G1]ÿÜÓÏÃqÙ‚OCÄ›"¹ò‘lÊ±‚›îÑXSyÁ>¡b@`”®4«¦¹C“Ë™I&VY=‡HŠ1üò¢¾	O™ó~u9Í¡[æH¶ù)L­…
šhÃµÄ?‰p8BZ5»]-”/ÓmE~
Èƒh¢ÃÃãé³é+áv¯Ì˜ÅÆdı‘ætlÓ‹©°²ã°ª/Õ»òÙaY·?ôh‹ˆo²j½6VHñp‘Vàİø8sè›¼àªÃ½ç6Êr³İ÷ûe—ëxˆ»~°v©ÍH
›ÔæZ‚ˆ^;R|;—$ YßÑÚ–^…"Ø3ÚÇ´€¯LËS—;¡AêM)0WyÁ‚_ª²¯9ÅŒùP&äªj³Ì@çkİàa‘½çäoô~~ 1Æ¢«È §ãe•‚eŒL>Ø™- h…=ò6_í`ÑS´ãk	÷ÓÁóøí1éñÃÆîB,³¯ü–†w†.üÄ0¼–qÄå<‡<ØFÛÇ2ü-2ŸTï{ı\2R^¶K“ Õ/¹˜|À
Ö@\,P­œˆb›ãAì°‘šf/<G33c—ˆyÄ>ªàï¬)òã>4*ø¢XXwªÜí¿+jä@€Çˆf¤¶à1HjYï0ÍµNĞ¯£>Rj©ñ>phdUåÁË»ØM)uSÊíFãÿšWH{”Ì«Ê­›rJs	m•'dB¯üìšs–±EœYªAsA@øªÁÔ§G—w&¡ÙœS»8›'~a£Š„yVÏ¦jöëi9d9ÒŠå?Ÿz£Óñ!Ó“ÈÖx¯`|¸†ùÊpV’ôTA. D£uÕBĞ‰Ú“˜|e;Üet·2JºS‹YO¸¢¥›¸J#Ì’ò¸!=†ÿ¤ıœ]9ß${G\x-IçÚÌx§İ¶–½…?x`l¼—MX ˜E/øê&	hGL5ˆß)ùL%“DBÆ
æ};‹Gõ û¢ô0<î
†`-'·vL}¯Ò‹Ú9R	àõı$p1Ë<İß#(E¸ÛQ¤r	yp=ı"û?àk6	±^Ø&×¦¡¼{¼’ö¡¶³…rëŠæîHS´&‹l‚Õ_H8Ä…à:Tw·¾~~ÁtB]´w¶I»ïXP¯ãËlGæ
iÆmSÖ+ÁèÛV ğÜĞÒV3éìİO‹g§rl£ïL»¨ß.YhJ/mxì¦r;ƒbS/cÂÂ ,]ïFˆåöØx†ÅsÃŒµÛï™ò¤ÕÕDğB§‰©‰%ç|\Ğl´Ñ—ğw×~£#i7ç„XJ»1í-„ÔÊOyo¥]¶ ¿ÿ‡J]gfÓcÖ—ò«›¿ë)«"•Ef’‘±š5÷=~2#«Û©mPŒet™GˆŠö:Io6‚¨õ2uˆ
d²Â››šÀÃhÃëÛÖFÊCl¨Œ;bh±ç9Ÿ‘‚Ê¶æÚîÀÁ@ úS	%¨ÎTíy6?%¡:–`!Lî$ĞìZ²F*¨‘» }œŸ¾]d-†×nğB´;’Úœ…ÀÎua*Ì1`¹•£VÍ¾ÀÚr$?ÎşEØU@‰‡ìò Ví‹ëSÁrXç¤Eıû»ŸìE–´}ãó$]œ®r³z
wÏ¢iÒˆøTMJ’½c¢N.LgéŞv:ßØûh©—§qâópg®VóàqO°÷ğ	Ã„Ã>¶¶{Ê£ñÂîr‡í”(‡g^Ğ0}LÁÎñ“áSmÁ†Ù¹‚ïºó|è$tF¨Ûèh¦ğ#%ú†`nJƒ„
›=\älUN¾†¬¬,…²ÅY¯qšÇØQµÂ±[êş°#İ·3äMÒdqwjê¤â$¶Æ'@òPÊ’ú8˜úÙö&s^[÷â”ïˆŸ7š¿¨ªË1‚ôUw$ÓEí<g¯’fÜ†3=Õ‘pÒÇ¨YßŠœÃæW¥Ÿ\º¸d©Z&Ó0p„,Ø ³a™é¬û†»šŸzebiG˜– °1‰õ½îô‰ùçŠÊf-EáÎùÚ[%
®jŸS.å[é²Wˆ4›Ì1Úã«ş¢õáØ6ßÀ	ûÈDØ‰úAÌAVÔÍ]GÁÂI˜í=0ıÒ(Aö8NÎŒÂıN¶gr|uV3„lØä•|%rK¶?UÇÓtÁepC„	Ï’lw÷^0 iÅ¸;¯W§³
WÚ#Évpı¡e¯û8Jßıßk›SŠåß„K¿ df:Ñ£2R
W==¯Ûu-Õ¡Ÿù¡çâdEzøLÜ¶ Í§ãpÎ9Š÷ë§ìŞª«§Jì´mk*¯ô6(ÔpöµĞq£¢-–Ãb‰y‚Í³¦=[¹qÔ1~ÊGóØlÚZºéw‰dft)‚Îé[Ÿ°ã›Sv·,|Şbj8Bé‚N§(1î_o|s*ğÍ»ü2aîĞ´BÔ²×..¾¤‚ûóE½jÜM{[Ú}Mû"¹`#ã9£g*¤0Ñ5U¡tHß½ÛiqgpìI“D¯ã{¥³æ­àÔaÑ¦İ¥¶>ÅûŠ’·†ê øŞ®Ì	Œšz„†p!/ ğ1yæåRÛ‚Û¸€ş¯p?_b›C˜ìú–zpRpê+Fşez…dëC¯ºß¿;ó¼#şeÛ§OÕ!=Üİï¡bƒÇ€Ïñ‹²ğ|«ozëÓÊìtùÍÈ§ô@&]àÈ)“GÄ´!ÍC­Úô~s;`´5²7°ÜğTôÜn¥t#kÅe–ÃAßÏÄñ _{‚{³XGqe3TÕâF.|j¢ÌÃÔw>1ÒK>=áÖ@îŸ‘£ª–9òîMŒ»É|hïE‹‚C™ÊçG×+ÁD
2áúš#ùØ[wŸ-¯„gÄ˜?ñcU¦s`»4#yU[îÄ­#7¨†ı*Æ‚ˆ\x3jO<vî3´¿>T}Äí>·pœiCRRQóQñ…›ŠÛÛ³këD‚'Šó <ãwáyÑDØh Uö°Í=óC¾§–ƒšıïü9…# ‰ÛOB.àzÀeN¼†V4 kö÷âì¤úÔMLÍ…]i;¡¹yöW‘‹½ïRA§‹®ÇŠ€Ï:qñr,uÃª·œ£‹¨h
ÍÛj?e©; H?X ‡ãÛØå`R˜U!³¬!´ñŠ¥y’êÊ^mhÏÿÆ¶×Ôg¸.BÚßDïg'“¥ôŞ¹ÔÁ>6zl…èãÃ»NÜ	:I 3JqĞB(*nÜú¤¾â]@!ãW[3Ù¯Ôú¬
†şŸjFÔ6ÙèİwËB””#úb:s+Hİ¢Ú„‚·€zm¨D&C- T-¹Ìò`¡Áçª¥_åí¢pco×@Ÿ}š²w¬h‹@ ˜ÔìA
_HêïÓ×¿“*¹E˜½AæÛ,zõ¶	+z%¶ô„É'/h«?’ñ{?ƒÕ}£½>6ÜÃIÒ—¸&|»¢«AtdòÁEîÓ9ã¹2Ùñõš{a,‘µéó–üïß±êÿ0­÷_ûœ0éwò"”ÃÍA*A?‘í4B¬n"%Ñc(ô1$~{…–ò˜·ÎYWÛ:tŞ´µ¿gß¸‹šSÚ¬CÚ´|ı¤€ÆSªÕ`(~TôÒ÷T)WÅä ıS“‹¢ÿ¿Êê²'‡HüŸdú]®Dp
z]Úö+?	ø *~®lc¼³ Ä¼ékM½ƒs\4HÀa>"Ğ}?Rş»Áœ£®ôußsä£rÈ§[ÊBùÃ²{ÔY(#uvÿ±y7€Ê+=hÒˆ¥CJ…u˜m°¯p.ôoÑÖÂÓí© Ae€ñô‚ÕÍx_ù„Ó|¾„I>ë—7@ ’ûÈ‡mú»zŒH¼¾¼3(ØŞèÆƒ_}å—N¾ûJ0´ÿ›ûUá*!Ù¸ÔÎ>=ˆ²R0ÎnÄw(Zb÷OtPÃ”i*øê1kó;@Wç{ez¢›= À³vÅša™±3Ñã³§ºXU €›jÃaœŠG#'eX&–­ê8—‚k+ô’@â5M;³QN%h
ıgy)lÌ‚¥ô…äìRâım8Ó÷e,Û5{¶AXö7Eq»{k*êÉ	ÿ­ ƒ\şVÊë`/¤e„|»>Y²÷ñ“ OZ‘E{­5$"$ráew­"_B‘¤!²v#°#o³¼ÜrÈÖñöÍó†!TM#bR¥>	W„Ôzr»1mè¡ï} 2¾Z0”İ¥~qÙ‘§¥ê=d h8HşmëaY=«Õ­¹ñË48Ùzø’¾kœ$%MHI1tõ¡7š[H.½KiĞŒ+D4‡¯Ã2Ê«>y¾ÉoÂ“ÓÆ÷÷Ù†¡vv¢UD1‰Zmy›Yêl¢ßÏpßü”Ôç„ÙšÀZ]Ãékùd¼¼ULê!ÚÔ9Qq~½@ÂlbàwWIá>ä¹,æ
iPxÇNÂRßØ»Şy®ÈJ\ÀuBİï¡@–Ããt[ú“ 0+…ìO³œŒ?»Xƒ SRDÍNÓ>ÊµObôÆ»|o–:5À…ŸØIŠä  D[RÁ­2™€£İSHeıÚ–šPE‡ŞPdŠš¾clŸpæ!FîAÖcyd3PRúêş7íB
V|¾DÁ´!©c%¤p~>oÖF4<É5° o†· ®¸ŞÅÚ-a×Õ©™–}ª²…ôßØ…,«æíÊÚÆM¼ÌSö<bÑz˜N&ŠÛŒë—+Á×€%EqfmÖ „ù|ë@Ê}¨ùC²ñÎåKí8M€ºEşòÁwğ-¡?»òÅYa$gtƒÓ Æ¹‰Ôí°Ñı¨f°€ön¼*ŠÅÔç$0½AzEË[(ôÂÀ’;´›F,Óõ<ñÊàºÑpµ††qD´y&LÚıì•”Ë¢¼È~Dğ‹3Û‡É„H-ƒætÓ¬&ÒS,x¢Dáş…ŠDçh'9&‘M-êÖà¤s÷"Yø“®¼Öt¢¸k/«Fà¥·F˜Ú…¡ÉÛ…2r­ ÿîÆ(0õ÷İG’ûÎ3æ!J)SÁS£¶öT€4ú_}˜ı™Ö6<Qß^i•jŒ0ûa‹X§‚*ˆ¼úòÉéÑã¿âÍæÁ™|óK\MùùÛ$|û‡ÁêJ˜«º¬â Ñ5Ah.h/A1•ñØş†’sØ†!%yGŠ1°Ü#b¹ÌÌx6Gº/J¤…:c%N mÈtÀT¥T‹agÚvGªåÅ—‰XßÑrâi¾[bjs8äÖ9/©–ÔKŒ–dA"÷Ë•/F¾{H
œµèrO”ó8î Ñğò•c6ïDcw™Ÿ/
º°wjvÉéDhÇÔí}ê;A‘ü¯4¨Ûœ†DI)ÂŸ“·²–ì¦I½`_»­yXé³6ø†˜7w_ĞÑøh[ğû³Å?ÏÏ\°ÜeAgXÊ óæ]b)Õ5øU…ÉM¢@»À’øú[fN azÙÇó“óà ÔZï—¡­5èÃød”W,%“4‰B2Rê ~<é±Úñ~­çm¹9C¦cSnŠ¨78EµP
#Bu‡* ®c	LhÓ¸¯" y/=Û¿–ºî7÷Èå˜BÀLPA¶2ó	~0+¨K:şhÃ”`àÎ©³ÊŸkŒ!4ı=È¹|VªÈk%})Üÿ£U¬<yÉ5şöì+ÉôÅí@JnV	ÜZ³­_‚n,¦§€ÚÊ)v¡@;¡lmq¿ã_¿XôËìrĞ³Ú8]|ÌL•ã„…Dß±÷OËc‘bşV3fòšH²€ÖğÑŸ0ù‰‡r$ş1¬{Í­fy¾)#S†¸>x†¥Óâ¤Ígù €â¡}ùËq¥LEh{?jq‰ƒ2\pò‚Óó÷Šå¦³½Ê…§@×U‘%@ÿ»!ä¦:ôş ïF œí»sº¡JbR³" Ş ÖÆˆ‰ÉÜÿæı×™gÌ½íàŸ×ÕöC¢ÕDrÎÈD÷JZŒÙåŞéš¾†¦á[øcå¼8@ğó™0B)µınÏHIâ@ÌµrÄ±Ù 1wşê±DT…®g};1e µ·¬³.qqá¹	}PÔØ—,T¸=ùuÆ¡¯N[PzgF”ÄFÅÙÀĞÔŒôÏš1)FWˆÆÙu±Ñá®ó¿sœ«qçE¬û`SG»¨Y³F{>£rÌ›	ÆNëw¥æ0ów±Î"Û‰‘,·ç}Aö©€ÂÿŞı‰–»>ác%nW·Éeâ”ACU!ç†óûÄ¢÷fuºİ‰Ü½”è¨eu"ò Øu¸NQî$ê¬Õİµ OLx‘h‰ÙX6a8–W­íŠãa	U·msfªŒâú\»eÈp	~XîKíÃ—	È}ÇOÜñ†•©\'[-,õ™àå÷´í|Ğ©‚ş¾µ=€ ½îÒØ@âÿ«œÏÊQp”Ïî€?Â{â0.kÒcIŠ‹u79`rƒš|SğQdQ’Å^dşJ]+pL+¹iIósR?Mr¡_³
døöê¦+Bæ»cˆMà½¤`z¯Ú7.ıëÈ‡."ûF
õÊQÙÿ 0ÁóU‰¤QæÇØÎQ‰RFıŠ™-ùJãUEİ¯zb¶˜»ØÈãKáõ½Š´Ş¨E·Âv½ÂßT®ì7MâÏ]¬"ŠW;/Íƒ1X~Íì ?ı¬“J!Ô¡±É8œsb~¦÷g1íkın¦ÈÒv«°úİH–½»Ï™EƒS%ñ ƒyº‰¡ùºËâ*BÓëî”ÒÔÏŸô+¯éó8J]@P~b÷ÈW[¨¸8³¦§ÍQšâÏ,×ı}—å¬@kÃ®£*2¡è-˜<	E(‚¸\^>ÁŠÿğ‚ùÄG§J&æ5ÚtÒÚ<À
İr¯_Î3u¦L-^\²"Oä|*ÚN…@\Öp[jMû’à\~„ñT5öD)¿Ï;‡½wƒ­©Ø+š‚:MŞµ~‡±Z7¦l­ß¶	¡ø¿†ÑÉ‰6Ge¨!§šƒt(¶×¹€ØãâN8ôbtÆâ.ÄÑ] Nè=_¶ØTOn]Éÿl¶ËÏ\^…›Bºµ×!=x9SÒ˜"„Á âZÒªjv7u»ìİ†$·M0?,0—1µh¾õ÷Ö¢™%ƒIÅ±xrbŒ™Ûç÷LÎ”à/ÕÖ§"Ê6”qº§Úd2’œ´vÏ4[©–ÛÚ±‹±»âS—Ù«eŞ ìÓ$«	3Á¼èaíwY ñmtãÂ{åıÊ:Ùc Ö8:ğ)ªæMaøÔõ€ô…ı¤¥I*L2±kİq®ïÛVt±o"MÁeaQ¿~É)|5AÅï_ Ç›A»¬¡êÑ‚L¤×^pIMBƒA1A_Ğè®t3KsCŸ,8NfÉ}Õ’\X>Ö£P’ï?â±Úsú…æ?pBeGUîğ´=4Ù\kæNˆ0şÆºËÉ©y¾æ¡âæ0J•ŸWhñ¿IÉé‡xñL4½ÏŠúSI&œ§ÿ:FÄFò‘/ÌŒªœ*-äâFø´LØ$/Ihå$cÑÎ®;g8¯B~ïr#æÙšå«í4•…È«Cšü ´ó–E—²|Ô2îeİ¯Ú'y´!*w\(|¡±İ-Ä¯ËÄ[½é/éİ¯Î¸	›©yeÕì«…ô™hô WÏ×{%âÏˆxÂ¯·D,w\…Y­ÎıÂ€ƒW;‡K]‘[l#%
w ©b1¦Î¸ÖØ—>xÂõÔ./ä+Ù@„~Yøò.£î®gn)·¥V¡Á˜sCür*ÚtwrÃÈŞ¸tw1¦3Ï”Û†=Òó0xÈ&˜2tÛP3ÊÆˆ@R\$ª3=06gµ;{2Aö€øWuœPTTğÒÿÕW‹Òêó4…„=´:gäi Nò^
ö”Ûé†Iú{3!ÀqÂÓu¿(ïTŸĞ›âUêæ‰JÅH¹“yótœÎ\5O18ø=ÜÁÁ;"løE‰o×XÑ¾¥µ=5ÚÀ\ĞÂ_2ÏÛ,üÒAÙHñ——Ğîğ®µr¹qT0˜³-mÓèJj’ÿR[%!H¿¯8nszˆÛ/œLÒH•écê[ÚãÉ"u§‚É‘h8 ŸAñŞ­!K8ÄÍD%È€x‘¶~"pÁC#VfX¹U¿+6¥"ÉìC¼pnê.g¸Z´bÙO™Ìi/µ¥ã ôÜÒ,€5={†„š2]ŒpüQgn @¶™56·¤Ïö‚+™à¨T£u£Q…¤»şQ•'ÃÁşg/ôÚØôL3já3oñ2ğÜÙCªú`¬Œ#nâ|ÿ?Í­Vµ)Ş£ñïÁŒ¢ô€sÕòó®ÄB‰Â	/Y!@
;†¸ ¦hØY7|ªñ³;	Å5F;0K.‚­GïÙiåĞÄ7U;˜»:¹ÒN%š›W;Ğ Í^î¸CŠìf+Æ`X¬ßJ] e C=.•âr/XtTê»ˆ¢Lï|<Y3Ó€±’ÃpT	«²u,.ºÖ(ïhòeı"R-Ş/kVÌÁ	édŒ$ØM§½^Áed;Ã§˜{¾óÀ¥½i‰†§ZaXt&øôqM·Íß ‘d]™ÊJ: (¾k¦ü9ÜãŸœ~õùe--‚1©0¤¾E‘Ã<Îo<ş‹“—ı£è€g*HYCÎ7âbŞøº‚%@k¸2»p­zŸ¤ùh&!è¢€Û”Ørûì¶®´•g¶uòÁÇ‰)¨Õ¬¸—‚51´>î¢šĞ°bWŞ?aš-.TŒåÍVVÃá¾Æß+ZtxJÉz!Êh¹É³rŒÃé	 …0m£fnAZĞGÿFıNZÆp¬RÆÆ[¢£4ørµ½ĞŒ31{õ¯Ò%>EMXÒ„ƒz¢ŸYçtZüİ²ıJ[³½¿À0h“µïL“©‘¨éB{²Z“|ş÷±™c¯x$ìL˜†	3|I½{rÂ¶„ézŞ(¥,}f›_afÔ³G_´ÿd‡‹)0º[ß\E©_ÓÀİ®5¾ÓYî‘ÑïÃˆüÎV“%(‡v¤ˆ.9I¥ãğ~…ÜS¥°N29•0ĞPæª¬Óêb94]Ç‘@¯¸0ù‚ÌâÀÀF¡ :†ã¼ÀÚ4¤ª}8´[D2Nv†>@Bf(ƒÉŞú_ì‚%kµËÔ/&ªı‡„ŠåÅÓ_¢ov¸,S¹ÙÄİ‡†ïB}È<o97È_¯9Xï9?‚”Œ …" ò“C¤BµOØê¿öÁ×¼Z‚P·+ÇÌg­™º®ì‚_üøÄÄ¶bâĞsª Ûö|U|¢kÎ«M8›çÓäİÄÇÁl§ëœ@E–dR|åWñQÁc[†ë™åìæ-=Æü¹Ë‚”¥eÀTûu>VktHësmGã¹«ÏĞ&~§Şó¤Ù2„ië†C”Ÿ„—¯çêŸËs|Í™şU¦0h*¶›„Goİ6äŞ›të‘<‰9¢Û3f¾â¢R$ÜÏ JtÌØ Vº§UêÖUïÑ­"|K¯Ü•WCJ¸ğG®!€3Ü0ÕRâ§iœ d66a†›Æ];l‰ı³Zx"…pùnşÂÈÕÎ´9Ãõñ?`&Í”¡dQRû(ÚŸOz¶A#½¿‡®ú%g¨¨`ÉWóĞÒ!#ˆµAU{³}²`¦(óIJ¸rå¹a§÷¸†LâË_eùxd	Íb’<†/0dÅ…E]FÓ¥¾SW³AJw“oHmA5#ßÌï{es8ïÌúİ‹ñøëcVY™B/Zni¶¯s$<!G\É ï~•òaÚKm•10ç­F{=yÉôÊÇî|É4l®‘C˜¸oìf¹K?m”UDšÏ±Y×IËA—áÅé‹ˆW­u!ŞVXé4ÏëĞ”aæ}ûaÜ¿ÖuâF5–ÙôZ–lF?X„›3‹Á‹ší×Ï8šĞ•%:¢áå§öxÂ+Ğ}whË——êò“Tåg8@1Ğ¼ş„l¦j‰ntz3´åÔç¨a\Ø¤í"˜åİ€ó2AØ%l§¢õOòİ3ÒiºŒ#à›ÂëA>Òònd¾–;w+r÷¨<¦|ËøSP¾,ª>S
¦%Æû¬3¨aôîw=§ìkÙæÚ÷d,>gÜ	3>RÜ?	øÊ£Å ¯–DóàŸ¬ÆŞŒ;U°IÏÇä">üú‡Æ­ U;Z~xÖ€Å65ÒıÊgä‰dµTbÔÖç‚L™4&ø7îWÄ<²qc`4a{¬HÆv!­}ÕVš®RI%4wÀ`t×’•ì©¬è¥r“ÀjñM¶Cás¬}7jÏ_Ÿt3O=˜9Ô!J—= ùdğ¯f Úf{{|—Ä
¨Ñ›@ĞıgÎ€|ÖŞÊg”¥B´†×•¡˜ÆÇuà!˜Kq·&ÕÊÖoR¶XuoTk‘@5±!ßh\†>G÷RØxmˆ{àFT±İŞ"ûëÿGU™¥ä§ÈÁÖP¾×I¡Óáh5M×QdÑ %¾r‘åuºäI»Wj+fj¡)T:¥ßI³LšÛÉâ­Hˆº‹qSC@I7fPqº.#U^À —šÆÒŠd&wMÑ—÷bÙ¾9İ@G‹s½±2±^BõRˆcıVæJ¾m@\2§&ïâ ‰x•Ë=İÈôQÓbSÙ^–+ÿkr·±6Zyì‡½vìJGoc­é8]ş^-ĞËÙ;¥Ñ!ˆ“3U˜yËZÜÿÍğ9¦Ñu;
j%#®|Ó¡u²üñ%’^a®¥cÌï›ñóD†Şû§“¸(SYª„äDd´9ª=)%i'SZø–EïğMì@b«;8öŸ 
”º7=$kàŒX”ÄÌ ú¨Ñ¤€ÿ$¥g
okm†JÓÏ®÷ù8ŠØ¯” TÕˆ°:¹Á¢í>æƒ Ù%êp#4¥eÅ¡í"Æ¸G¶î‡q›¸ÁqÅá€Š3Ê>ğ¾qŸñ­âÕ1P1z`­óYÛtŸ§î†Zâøá$Dµl&ïïIÿÁ¨Šá„jaP8å=1&+åÉLô@¬ºW2ö„qñH±ƒ™èK,ó/H©“ËU•ÆäM¡]„QĞOÑ*½Fl~BîÓdudÕ3s×ó¶=pËµ«›Ğ§öd*ì=n	ltä%k€Ğ“§¥¾@"‰s1Á&Ş½å[GK|=‰&)Üuí÷¯|Ü/±'ÆÜµ–JF¨ˆİ¥,Öª}ê?Ğôš{ËÛ·?ÎÅğà¹Å`ÓU)[çäş‰%£¡é­æ +Ü,­ËñwEüÕşëıàZUz7jŸ§JöGˆY®HIúØÍß™vÏ³×Ä¹‡[w¡£ÎV]°<¢MŒ'˜ÅDÁ×ûşE˜y¹D²ÁÏ
)Z…ò…&øS÷á>ã9>zá<@Yî$ƒşz¢>2£8úŒ‰m#<«Ã,$s74 …"_£¶&tÏ•UŒ„ó ÏÁ‰Ùû›i»QQL”ãqL1òXj“^ú¤uæÉ.´=Q{x^{©»¦Œ¯Õ¡NŠ™Û&eíÈ ¶ÆAóR”£$]ß‹ã·QtCÔã5Öæ¯|-<É|?Õñ@üãÅƒo:$C˜).q¶Ô¥³äKúEjDnŒëní¢?&#ydµ†¡G¸Hº µt–$÷É±ÖÇš–¹¹Gp¡I/ïğ¬V¥oS: }W¦#Êí¸xÉ~Øñ)UV\ĞmõCfZ¿şGë%«uºÌ˜ûß\ıbÈÄo¿×®P ².†9Û¸÷ü´[&òğò.¨}d”9€—±ôCldvËâ€s8«³$6R©]'YbÖ¼š÷3¯wƒEÃUŞ=äõXÒ¡†Çã½gënlî’€ÿ˜1œ”4»çâÕCIxf4ïŞ”Öà	^1Y8i›¦n¥šõëÏœÇh1ŒW+ã(/ĞªX0÷u~=ôƒÃ=OÆÙÛ´&Ò2L*Î	}õ7#DÛ¦ÆŒ5RÖYv½lÜúû¢C“,¨5©X?BĞ*æ’(ş/Òùà
qGt«ñ¯Aà°å$ìön¬—MKmnÿ ^|UK«F¨Ã¼×äËíX„¢¸^¦L¿PŸúÇÄ:DÀ${D  ESø]åR§¤›wj³†6ÖËÊ*|1ŞÆ‘m±‹N1i}Ã«Ã,UÄ/W –ˆÜS”ßT4‘4ŸºT7@npEp^œÉ<=#¿İÿyµè+@|Û?Bsşq¤G÷2Ø¢æñ%.37§â	.±;üÚ²¬‹Å½kFzÚ;ÿŒÒ×ÍkÊØuî<‹*8ÎÊœLÜ(auwe`o¬KJpa–	˜¥ÔzäˆñÌİtŠªHrRs{HnB?6ñ£"8˜ZZÁ 6¡ó6·ÆÆ	ÚèL¢n†=·UÌÁ8¶Ğ½½nŠg6ü¢&îXÒÚ¥!”ÓëÅv¹9È£2ßş§ÙóèıSáÆ,P&3¤\VC[Ëuûş;'÷øæĞ1›l¹êÎÌ)öQÙ÷èk×O¸Ú5Ñ’JÜğzb}&'rƒMz»Ü)…™+$—¥~ ˆ¬+ì²_ÎiC›˜™ÃU¶YéF~!l#ÔÇ01Hğ%D#LfMv
ëÇ†iÒ Ø‚¢X¥"T€ºîõ·Öü«Š“;‰IÜnÚÅéÕ
‰^oÁ”õrÿd‰_n† ™B8ƒG°ö	±dˆrnê”]û¢Ô°A@€¦’ªTµüÒDÇe
+ÍVß-"ÓÍCè‹(±²Ú¥ì?ËÙŸ²[Á„˜ÏY0…¾åÎ0‘GÕ!îúi«€îh¡D/&m"ãè¬øZ(çVô=›òi¨éÛÿynSr€/u^MO­SH±6Béò Lƒ~<ôîÎe‘öT0#ë–·ğ>ÿzê€~í†™£øaŒ¦Pñ&C“ã›ÅğÕ•ûşŸ|ƒÃI§}-øAVîoR°Ìn¾HªD †B¶«:s«²5u¦rÂo¢Ö­–Õz‚IûZ†šÈ÷ê¬ÑÍ©ÑĞóúVç 	Î ÿÀvªFù÷@ïCã+¥²?ĞSNEÂéüX”¬~!»¶D@ÜùÑş¯y!îrÎı É’wA*×8#pŞ&¢~6ªWæ—qY±!‡^U$gá®Ç]8
‹9* YI?by±™Ú¼Yîjhücx»WÊQˆaF{µÀ9¡UmÃªşØ»Íw¥ÆÊ]1sXà‚$‘õy‰FqF•:Æşí#n¢,ÍÀÛúİ(ÙƒÄX ŠÜ\3;-ØÑ¶ßìİÑQè‹Fùqd1,öŞ8šêjÚ“³’B<â¥`¾ŒÅié¦—-¯0
Ê¡!&J½q÷X]g=0ËP°ÁÓ–ö«&	 Òx‡ÉúIãiD™ÿ)	üHİ_{¾p=õàŞ§mr–"€#ÄëñQ©”Gc{&”¶}}¾ê!³~úÑtb’bjv¦‡9ıà2ß6Sİbc5ÃÕnœ'A—å4‘kƒWÉ1Û%ËP.µAì×qÖ'©O/j1àñhY: )¨¡JJÂ›Í,³Õ›X!W/©¡`€Y1-ùîb„şöÖ¹v…òó‘óôî/+9 †Á;Ä¿Ó„?°g FRO‡mö[GŸ¨ÖPPIs¦{Ÿøuê\Å:ÉæœmA(ds\|sœwşÏxVÿ/]˜¿d u?dp[¾Œ…OUh›ô l­|úŞ3Á8¯¯Ê@8ŸTY•º«ûÍ“†a¤ÿ¿á5v\ E9ô‚Uåù!¯æ”¸›Ú-¹·35[»=Ö{ÑÀ€MÓérö­…˜_xûÕûáR@¶f{fïéî07	ç5†Ø"ì¸€ÇEâ”“ˆŒ%[p_~Ä«òæ‹¸õ‘Óy»[‚f¡–‘ê‘^V¢P¤&åCÿ4Š"â\êpd¶ğÔñÁ‚l¾;8qÒm;ŒÚÖ/%M-G½èx-º»U$åÈFhé¼Heô;,ˆj®bª¿4ËX•óÁºhé—	"6ùºÌ0‘}¬ªháÆxQGPK3f?2¼vË2Ëj¸y—›–3`íº»ƒªJÖb¼·¥Pœ‚¯)’/ß“½¦ÑÛ#G3Œ$İêÍ
œ›˜€n“Èj’«lJŞ~'ì(¬ÿã¸ËÂ>xûaßaQLniÈÆÔ[6‰\‹[03)ºï¼µªv¦AF:'ÂZ	©ùÉ ÿ™~2ÏÒm~Ô¼‚ŒFT° :È+×“Š4Qÿ‹QÑV¯—iW€S%ñˆı=Í17Kªì1áómÌÂ9•*5²V>l³yùÃ¯¯r[<”NÊî9Èı±½¡§ò:µ©n·ÇÎ²M+¨ò×ÄŒ»­"#§å¥ 5y!y©¼ÿÁ)goğ øU2Z ‘io!Äş&çE|=<ğÍĞZòå·èp½vÌtqu¨«SÑÏb„n‰¤İfÕüîùÒû•í£*"!t„£=ëØkê×á‹<8”óËÜ› £É7T¹™înc×7†ßÄ“ñVûìd,ï-Ü™êì`YUáqTóUv‡6§lÆÔÓ¶'Ö‰ç®ãæMÄ<NşŒ‚¶9föÅô'|–*9­"Xµ?ã{Æˆ¬‚•QóY°À@ğˆ"³oÙ¥ª(ÿo¾]Ö5<=â¢«Ë/SI=N|³÷hÛõg„©bŠË¿­¬ëkşë7Äõ°Ô§¶éd•±…UsÃI­”lÌÖw<<O9Ùl—.“åzÏ«àöŒ§ÓÃre¬¤ŠÔ êq‰#UÙ³³`'qUøëk °\ŠÉU¨“ÀÑó
=Íé4H‚åx)Şhp•+§ZBj1ß7"«X¦b¬HÓs›Q¯>´oÔõÕÿ§wºF@$¨¹®ó”Šãhˆƒ\ã”StÉÜFy†0¾òb¾dàÊsğæÖh{F*–;`©~4ÎÍ3ëcòM,%¥h\ç#lÉ(a±3Ûi"F@›X(Q™M`K€‚7:çp¦Ï:ˆ=ád³à/(·/sº9úÛiCfoãzIKLtÄ®Ød¯óœ.`Eºtƒ…™*$‚İÊÚÄ–$§”–*Y|-Êû9şıbè½IS’,B½7ú3û Îö¥¬rkêwMí8èÿĞ8Š™'¿É—ø%û4÷?Ù†ÚÏ Lãš5f	I­ˆmšÚÙ€.Ë©ğvµä÷ÒZİË^\Œ»]aèF}"hŠ «+Æ˜|ÔÙ]³Ï=%×/ŞÇCˆ€všµ;)«·ˆáxaöÓ
š¡û3Ï¿Üş¾Æ’¯ufJÓ)Aù×ÕŒ.*º¿>:îäsÚ¡¤Ê¹±·‘ÄhAÀ›²ks"ÆúØˆ×'…¯ë&­ñ¼…ÂI®=ÊqWışiÆiroèM6J0†ÄÉ¸V<5u‚ua?³½“œ×Äßı°Å0A–O8Äúğ\ÀeáÏÇ28¿¨¹¿e''ÉÇÈFË2nÌn#9•üŒ7ê}©òÈ×¿om­X¦ÆI%¤%¾·$”¸FåiË™3”yõ—ô~¦CMTkò‘ıx~ı'[p©¨…H ¸ {Óg³»&½3şóûĞÄ¤±†
Î©€*İ0h^5DÉ:1¢×»½—$jX5RµÆoôväM/U8T¬ÅÕ1ÕIiµŒ^ŞJÎèíÆÛ¢ÿQº&”Dª|h‡+÷K¹rYµ0¡½í;ajó&§øuÙÖ›œÚñ	·5÷9yšÑå _N»WVĞ)T5§ÉˆâBpÆÿxóĞ$“må—ËôÉ-&‚»ZP5k>\–@Ğ#)I ÛiÂÀòqB Ëı)Ì¢^ªšNÑ-INe}`ÉÔÌ@-dW_f ìæî¯‡f‡¤A»â“–ÏkÏ‹íšË§¹nÖ´Ö²)Àu‘éälUç-È+' ÈÆaWk¯Ğé¶lHÀ-"tœÀ{’Ä£Á8ÃÍO´B;á-‹`.#iT‹°HmJßfŒ‘Éë!Ş˜6!Æ1Ö«©­Sş×µúÌ+cÆR3½¿(SÊv”õ³Ü\Î.¾ÿÌÁ>ô(	œŞ*“Bû¨Ã9LäèéófMöRÿ“³‡˜MåqB×:_~
{l±·ÔglrÛÆºğI£	C¥=õØUR]1$­©lmvÚx:Âô9ÊlßıÔZ¨j+(îâ'CøèáÈïÄ¡¿Ä·ã)ärÈuà2ç“}JÃŠ7ÅycÙ©#¦müŒå”á•o$#ë>_E˜%õéòcê’ÕÇÔVŞ.É‡§¨‚'ËÂôÇnØAiNB2öÌPffQô_W$JŸ_=­‘;R2¥xGÙÂÄìDLË
Qj~ ¬«Z€Õñ*½Nb¡"v H}ÄªµjøPªè¾Ä	ÇµÆæ¨HÍœi@ÊY8#¶ÖHìSâ‰k=IÅS^×ê«;vÅ‰•Ñúh61m’Vs?¢èôØôN`b~ÆjÕYˆíö¼`LT×av§[¶¨gÇUİµ'y…H¤HŸ’7™leúQJ¨[Ï3ï"ÅR±n¹-¤F‚¶˜5˜&¼K‘Õ)i‘=å"ƒ©M¿ñ«åm9äŸ ï¼²QZ§"–å°¯~byhqØ5&f‰3·‹ëÚN÷?Z4æZF.¯»ãg®?¼œôê2÷™Šæ`vE$Jø¿;}şwëZl&ı½4s ®P"Ğ6½®Ï®ÊåG”†™Ç¹.äåÂ ¢àÛŞÌ.J*q‘‡nZ¾TÒ3rS0)4p,·Ö6Öù¯ azê/D)±@Î@ôñÚSZäË1™Ñã¾eA®¹N1+2(ë&Ü =m™á¯0uJh‹è¹ŠâKÓ Oø¾Ë:QÊ‚‚APIõó¸—<üÑø›šÿÕå¾ D¶¨79CöÑÓO$(Ÿø#î-u÷3ğWœ×ĞEì÷|Â[ÿ!	º‡‹¨£ãû.7ğ‡ZoCITºRÓ„t´ñ«Hë;qıàgè–%±˜ƒ¤G³1êÙ„cË¾^Y¥QYG™Äƒ¨
Ca¾2z”÷Vç¼QA€1j ¡¾E.„ûo°à†Ì¦<ÅÏÁÛ»õ“Òrs¬ÑæÕÀ:tVÒ¦.ï„4ÊÓQ‹"€ŸñI.¹‘ƒíÄƒŞmİEZƒ B (­´÷©ŠŸÉ,¶Ç! ©Êî"BDšÖó,.ĞZÑ/ÍóU==>É»ÖN92FQG­mÂÔ&Ï¶,W!]Q™`S„ZCåŸ„“:£²e‚Û~'W˜uß—Ó
ÜŠı3y¦/@ÍR9éë¬‹(xKR’ö™†r¥-jrè•"šäq¡—¹UÑÌ:±‹tŠ‚G_³?H~é$EU†Ëæ2–ïè ¯½ØU“@Ò*o«?5\YÓ;hšş¯Uš¢9ciqÄDÇvkò4vc‚ö¾z1ÕA8Á‚{"ÃÀ£æ§Ó:Z®MÏWmÑµ?,îs‰ß•»øİâ­Ø‡öİL¹¢9İÏv»Dtˆ˜qÓÍÖZwì½äc˜,õÅŠÔ¹Ä½m£|_ø³_/8üæÑVâÎ‹3l÷T#P€iÒ`T²6ãeÓ—ºqdŒù5HGÉïÜôaw€Ó4‰ÙØÍNmÍ+üóëâÀµš…±xj(v¦eac!gÍ‰ñ !Bãz&ñéó¦5„#˜8œè´Æ±Ó£÷K€Ì»ä­ ›Ì*nQùÍ¿…‘™•øÑÀ|×Ãå~v„×zäö‹d-ñ¾Ã_É.GètÎ8ç~ıÃáŠ`ÿÆôd±ìTÍÿR¸ÀÃ-²Óª‰ôòe	&µÅÁ9Ê—Ş…–;t¡T{ëR6O¯~ÙÒdPŠäãoB[{öŠ¯‘^!÷¤µâ­Í ï‰¿@Ù=è»ÿ‰¶(Š–5™l	ÛÈï^¯Q?ÃF‘Œæ3èGªøÜş,Sİ²¡^‹õPœŞˆƒs¤M˜º ò[L»áIez´˜Lö%Ã^ğ.	Ñ/Æ…Ë‘\ÑÅ{Š$4CxÑWØ¸;.4²ÒU`HÚÛ¡K³Öó.ÁÒóN)+¢Èz¾›|PÓû¸˜–'I¼üôeƒ=M X öÎpùî”%HëáŒúË“†Xš`SdÌ¾îŒ·<y•¦Õ+s 8áEè’çkzeSA[;€ütm…;šï? «ğ_½CìR	ø}öúóÏ_mé)ô¹VÙ¸SÉ~Ä*¤€P<1\Êë?öép±òÓ°„Âœœ‰Õ[fòÚìh8D9ö†0ØT¿É0aö¹U[‰¹‡iCÖD:_¾Ã\AHßìì´'ÖÛ¶²‘?‚7®¸… –)Í_L.¥Áğt-ĞAA´Õ ¡7$Eçä*Å²¤ÂÛ§ğÙ,6Ë{U‹E1©PË[Ù·s–<õ+{ı‚ë#Ö¸+«Á- µÑÙö:Ë³œº¿ úTõI¬†'Ç€mHü9R@€~,|¥äNº#Gó`bd;n°¦ëí3år¡s°œí•tpJ¾Vgí÷=š"c6ÛõªÓi\-²W¯AŒHåÑ—“ùfèõµ¼¥ÓañúŒ4	çg"$—5Æ3Ó«4Ë³X‹T2FoQ˜-@1}Ón­®Ù,wáÖÅ³0N¶òİ×¶ø—3.M¯LÑë§æ˜š¶HŸJoP ¬Øƒ>´,~çKR'Û7’˜ÌXˆ}\Œ~S°…}“¢2›”-q”/›2£x€ÏYC@Û#*¢¡±|ºI» şŒÖ~¬rDÓtê2ÆÆø±ä:KqNzè/’¡&	Ï¿U£jüÓ1÷¼YCÅ´Ş´OÀSÚí‡p'FgÉ¤tË0¬bGº.õ³“‰´ƒOzÜÃçYnüV±°hK‘ùc8ø
Ã7\á÷İPä\y®3ÜkÆnôL5(¤–“Qnª·eÓ•ÑòR©ÂÈª;Q,bŒvY>d-æ'…#›~Ã¢–ºøK=8ÑqGto [^/¥`?
)ìW® ûR¤I*q
#z‚$"mKCÁÔù4ˆ˜ÎÃ<¼Ş«N¯±ƒ5QDëæª¿—Öîu«‘m*£¿´‰Ï…¶] \¿¶ÉË0¬YıN®Ö6“¸6xó0‰!±´
g!ÔÎÁúB`e™¼EÙƒëöš
	L¾KòlÂb–“¡ş),`i«†õt±ó-y›ˆØd¤şÉ½JrfğÎìx®ì]‡a<_'ç¦R;'L=4:lÖ	Ôñç–«¦Ş¥&“ûád@R øU”¯Vé­	ÅÕ–³ 0³Hz™æ(Í‹y×± ®¡&­®ÉÄj©mU¡ˆÆP´ªæ‹ö¯ìu•¢¶‘ØÏ%5B{´Ø®(m±y7M«§~$Lr áÚº¾à¾Lùe§ìZæ4#îîÑÖÊi5€]×¥e#ºßŒ½?ßÄ·çÜ¨D5h³Xeo„.oì¶Ö¦*„±Lh$TI-qƒ4Æ
æÒ<æ±^5ŒŞÊ8Y‹y7Û¼Ò¡>3z®Àï4eOg†Pïõ³7àšÜRÎl\‘?ZcÏ|Ól‹Ûö'ı¿‘ª­°îñ{EÈBÛ‚bxk;ÛÉûÉ˜ëLuLD¤DbÊıÃnƒx&”1ˆKXÂÀ”¢	…˜£ŒæPäSP‚ÃÒwlMb)$#¤>CšÕà4ÖlîĞP‰-"ÆqÀL2)şVcÍ²÷„[6Ä*˜Ï­q2faÄÈ§Ên]È¢µà[–G)éx[tû¥|œc€OPvIık9·S	9bón=‰Ğ€R„OOÌšp<öŒİ¼¹Í$Ò›€òºo!«Æ$$æôàØã•9'Njì¼ƒf0éãoÖwƒHB×'ø‘Ö3ı¥×pW¶o±Ñdœ+­µ­£­"ï¿üô*;Í¶j€Y‘ti\’¨-S¾%,7&
àQÚô­Ï s–×`{k?½NÉfÂy¯ğµ”ÊrÍyñU9rõÑ-FèwöI†2òêô˜”tÕäª
Aâ-ÀÎÛ£Ápæµ<Eñ,qrjåÕ¬ğG{¦We{µ(„léZ€Ãb.ş9‘ÜH»NAÊ&$=•+ZÛk¸t]0
NşÜªÖÒUÆK™®ã(Â¨-k~ûph×K«Âi¡¶è‹â‘vfKæ+.êáŠwÃÒ™’®ÿVÛBî‰sa¥K£[i_$Ìvë $¹¥ŸÎu@ŞmNÕu‡1¯-%¨™Jøàt«~/,Ì¦*ú¢(ûE¬oŸ°ÿ¥Ó8¤«.Ìl”‚82#êºÓ‹ç@¡G%ÙerL‚"mûÌÅ ­%?"è	blıo‚à½æákÜté*Ê®­½;ÕÔáŠÙ+DFÈ¦ê”på2¦ÕltD–c ¡øwTg|¡ë:ad&®ò™@s9ÿš¼'=‘à_uìvÙ»y¿	HtÅÙĞ¼7ôô$8½XêŞ&¤uôµXPï#ÔË©yâôW¸?2aşO„wØ£l§„¤ê£c=°tø«m´Mô»><šWã)Cz­V_õØ¢O°&5”»U¯>)ğßyn3g3ºTü¹}ÑÂ›kè-kí<ÿâ™&‡DëŠ›*@XÕİ\ØãĞ"-ÅP°·£¾ûÙåø1ú‚Ücã€‘a'òõ§)fS“:ª®Àá€Ü ZÇ@å{uÅSïè¹4':£PyÁ¯=uiúv^±©ˆ±ÿø‘oPòŒíñ™iß«cÍ¢ùa†WÑÚñ^y·GÀòßFDq(8Q«¿‚šşZÛ_ªÂAÎ^ãàÀÌdäÉnHÏ¬Œgw¾G#a5„–â=±ÉèxgP(±ÿĞ¼Aüú—~¦rYÁ’Ql1q–úDõNoYŒòàiİ¬mß
jse‹^€cæ[$Ùï2¡>qÆ“ò&<­F=Ëîn¿Êà„±§÷“ùÔŞ”)ï[Š	Óp›0Ju’¯âÇ^b€*£@#Üú,"àû‰M[C2¬öóÁ4YÜ á¾©šn¥.U`á£ã Êû‹`ÿ10²`zKïU¥ÈŠ"|1¬Y–½Ù©ûÌ»ôTPã>â–$89ö3 °{ÆJvW¦+Ã6¹ˆzß´´#¬I-›ÔØâ:ÌÑíËo9!Œ\ Ñd½bšéÇƒ*Ñ³>¦“îÒr :*Ôä°/)œïú…ˆRB.Ü-Ú¾ÇƒèT^
¬6ÈşÍ3jŠ;ËYĞQÃ¼éğØ£æô­©f“Å†ß˜^©Ê(ûôßM}ºÌ;İ–‰íP‚Î°FÖ0Ác¯¸Jn=fKÊeà™bù[˜æfÃ1}ú¬ßC]<HÚ%İù˜ÁâÂ>»vtÄ!«gZi~‚íX¾*—ÅS÷›l"`¹]İ§û(å¢²ë`ÊŠá'¢'ı{şóJ™Ât;â•;:J(ÄpïUN¬…éQNõy‚‚ş¡/ªÔ…¦2ÛàsQã©Ái/y¤I®NEF®ù!*‹M­áY4¦‹¡>Ö­¡„C+È5wâêÄ3İš-F“ÖÑı¸LÍË_í(’—ƒ}>ÀÖ<±Î¥RJµŒ
KÀ£cT<¯Âö›N¢»TB_u4ö»ÅéÈP:»¤u v;.*ÏBÏt<À›hã(‡¥4"â—¡¼Üƒcò2D½ZD/ë`sUĞUßîç>bß@aÆ;&W‰*3YÈeòZ¢ô¨¿À¿½¶¬•}câêé0,ƒZnô¾BÔeÚ÷¥°J“ÌúõY«"mvM`¢8§/Un›‰¢!3Zt\è#‡hüH}2sÖg˜´%‘l‹Ú#hƒ	’zÔƒª˜4[¡1ƒ©äÇ7K§°D+8Ã¿—}¢Š¼[K¸TE¸ñOcQp\	€7öNKó´°¡x“ÂQ¤>.v7<fû@ÙÕ’,@uæşÿq^Üş‡£ÛeåL~ "Ôğ Å­~mÁ1>Ó«s¬\½DÒ#şUTPÜà¸™˜ŒQ#<ÒdJ×ÕÅ_~“Ç½}Q­%Øªà}ÇP»®ZÛ	í2P¢Jje"2zS›8F8
—vdF Zyë;—¾wõ’R)Ëm¡M—ÓLt{ÄÃ„_ÑqîØRcÜ=Ã3Ä=UW–O·Èg•9yuÆô£gÔ¶jŸ/ÚÖn)fIúHšü÷Ü&Zn›ô“%[^~év0Ìº”Mál> #/éË Q'íåV?…0VdäÎ#U,k\ôõıñ; -Xê¥¤æröÁ†›€t&¦>ÙFwàsû\ÚGYDiaÏbÌJ5Ëò°MJ¢-Û?ŞîÅù]ÚSºÕŞ)uJìàœz'~À¦Ï-Díz“iü4µ0,yÈÁ'?Ç~ÇÑ´:kûÈíÀ¼’^|°Z# $N&Òm×i.u±‚Árb>ëäÕ§z Ş¯ûÏÄÅáz2Ò¤§¨t5z3B7YL{¯5Óš0V2â¹Åñ¤¬×İnèlŞœ‡º‰ãƒùu·ÁºMz™YIí¸ølª´TOÄ”]+v•»u‚§™şyVîëõPŒ÷Nªåò«ïœl! f6b4$¯ÍåüÏ[Ûx¡[Y²w õúÏ¬ÀŸH—;RMì áØgzú­2=ŞÎƒÅXNšb/£à6FT˜F6ëK½ÿæâ6€kªûHPªç°9¨èÚ¥îçÔôz-û£é¾BsÒRKŒ#ñÜ_×AECñ	¼CXğéDˆSJpçvcQQ0FG]ôJÑV˜´4G´g…Å1"‡}}{„Ëc³½¸Zu
pğ1²(†q*"÷¤<“nL…+›cÄ£lÚ7Ûİ·³+9*‡YàH«oÔ´e5hd…~ŞJ²µí7@ı»&`(¯º|ÔÑè	â€”½­Zn‡ª<­•½¶ÒfñGJR/‘Ty˜Ÿ	ŸTF%(¹a._…I
LªCÒ2¼«Äiû›!‚e$-ßdÜíR5"‹fşZÉ²œ|*pô&ñLÁ|âw(€ß„)íjyíëîñ ùöV«9A_;OÆä³¸ bh™®ªÊuè…rq^'ùçÇOÂv¿s ×õÿŠ¢6úVÁ%¡KF,âa4ØÁg‹j«„ò/¤ÎéX[—@Êä;ŒÏÆMoøÔTprmÚ5*­g¸Œ¦4:6ÀLh›cb&fkHLTsÙ@âìõ&¾·¼Ê`©–«ç±Ê£VM¿_¹œ!’Ñ•ı/®™àé¬€ØúfW×ßw&8~/¨2g”×HE®qpçıÉ‘Û¹wş¦âæçŸ
¦ø“¶(Ğû`SôöH‹¼nùU¬r“P)zv0]ÆÄ²&ÉöÍé¾­uˆ§H	·)¢\Ëtvä.Â¢·$\½KÓ‚--ÿrrBQeñ›ºÃôĞBÈa÷		Åî-E¼PØÓDJlv|â:RÌ+‹WÆO<… È/Y¯I´‹ïÌ¿À´•cäù5ªÜfŞaW`E;ĞQËÉi%uüø0ÑkÎ-	®,wlo]ıgƒÆ¦ùAÉÖšKa<^Y¡¨X½B×Ş¶ŠÊúVo>@
÷QÜùø
Ü{ıK¥Ë½©iÎäAèöC’”8ÍŸ½ç)½.¨12&]Ó™oJº Ùµ7:ŠipGHá¸§ÿyd Ó.qvËë±ê`õ¯ÚYy7Â6©sRl©NeùKºRg*—'H;I~ğ)‡vâ‹L+'ú#ŸÒ»¦VIşÄT=<:Ü*Ülğ²Ô¡Ç',q¼éš‡-5Ga0GÔÃå3ºÏ“áõ’&èŞÊ¹€}ˆ@÷Øí‘!¾U¤BNÌ^~FP¼n;ßú*=›Ü1Ñ†¦±‘éñğzŞó¹•ŒMØÅÅƒrÌ‹J)ê ®(·›Z‡ÊHUÄ¦H¡7R²Êu’d]d'ÄÛò[énõ2u?$ÓKbl/
´&g`Jƒp3QÆÃQ3—mÖ	´n¬%i¤’+]¡†ìÖ–tv?õŸrÉy‚€¸öğÅŠHƒ¤.âÀ¼8™ıİË%G5h¾yš„°º®5ùRo™b"©=…/jc…1¶ å"øÔ„ªX«m›\õXò‰ò’†&w‡ø20·(W â©÷G?%®d·¶P“Äq^“ç<@$ABm¢éµZ boù¢Pò¹1Àpñ¬£édÓ.gˆt«3Î^ÚJû*>Ç•Ö1"ÑŠZd8Ÿ…İ…~>ñ#Â¼İ+>KØ}vÍ/ÊF²ØNjô/XÔ'á×™]À7|R¦5s^6ní:®­dığ16€ä–6H°9ÿS]E¶x2D.Õ?Ò—?L•Ær	 ]Ån³,?"ctOP«¢;´3¾¯x™p“Ìh2)yŞlÒ‡)£F ²ûâo‡6zŞ°æ-„ÈlÊ©h.ÓFe;ÜGº+:}ü$øòŒ0.¬¦zº®¦Jt
\¸läãö•—A–Ë§¾5úà”Í¨’æ‰”|m×î8Fü,ªwÏšğâ-°HüĞY±Î–4åˆN|&á3ZÅÑ)QÅ6Ç	ô;¹­uhVGm¶2YÒˆ¹ 8Ù>wˆE·%Xé–¾Àg¾í¸`Pï×ÃÊB£ÑZò¦;ÈæÊŸÈ(fDá»óK&ùè@5øö¯ú\£íXCyŸ¶4¬¯—XpXä°C%©å×hYF0¿ôi.^Ãÿ5J¢ì8ñºÇ1dXÕÏ!“Ëì¦ónbÑìqšê°{tÍh W€%K>pÊ2¤:¤Jù$“ƒªN nRˆõcå7E¬©ÚMqÑâÿxyY
ïÚ¯‘[xåQTl ¯_¤Ø–“4|Ğ«Õª´ì¥b±<•ıæTA!˜>KEÑJÈj¶I¹Ï‡%×<\>ıB’™}Ö²fix2]Ï}kÎ1‹¨%O¢P	;LD'âh tw CzĞ$ÿ(/ûğ½?ØYMüTıd°Î³Ét$.±PùV–˜»Ø?]·’7B‡Äõsî«Óß_ø+—ÇÌhe‰[ Œˆ·ËTÀg×€‡lˆ§]¾YíŒS¿Í»l;ÍgÁÆKpJl•>&*ëR,ÒÄ)z¥v?Óa¡+Ãiş`ÀƒFàQZ'Œß4oìÕ¶âßô¿‘ä½r<ŠÀ†–Ùßë2u¸UÕ¦O±!øS¢Ê‰Ö
l3zZjZ¥¾&J~qäæ¬p¤eUYÀÙ;ëé\W]~«(<_"’LQ³ö)‡#K64ÂùéÕøcşåMªêxGÃ¼û.±-Àú"¼­üâCó-÷-ìà³®°+T§í¥:Ÿâ'fl å=Õ¶;K7)ßìpa4:u'úø#ÇíÒõâæqó¨«¾@­ÎÕoÉ`æŒwşo§5“‡U©e¿ë?-£=Ç Å@ŒşË=éL’šPCôbr,›oœ@GÁYµP¹¸M­¶7¥¾;7a	Ì'}Rô;F5¢ìW]‡f	““;şĞ`‡Õ(Sh¤ë‘€ŞñèÄ€¶Ú!®kDg8Mğä)lFB.°O
Z‘fTK×<—¦w9ù°q—HæZÚO­œüZÂ±¿±­Äİ^İÒq¹¨“C‡ğÖ¾Œ®×‚X@ëöÃ|½ø5@¾¾w£ Ëí”(õLQ)Ş†lƒ¤z”]Å‡‚×H†§Ét·$ÙGíŸ-äÉÊŠ©Ä+@“ıÜP&[òÄeEQaˆ‡áéÛ{A†
Y&® æÔ²5j)~øé³ìş#}bşQI´"µl0º™’X¿x§X»ËtlNé:‰›\°ÃƒÅßs>¦Ué;* ‹€#Qá‰2á}0ä©§Š^h`ß@»%‘â¨¯Ê”#…ÃÕóÕ	çƒªà¦V	¨èİ’—}±I¾”î·@G5•aHL ;«”å{
Ïo)æG.qÁ>—“å€Qs¹‡{ƒgÌORÆ6oû v_à8_º[÷ùI£Òv…Í”Q™®À×›µeÀ(¼²º´¥ê;†¿9Ä•e ×¯Sà!ó4ª‰r´¼pèVM¹ß)Ü‹¾(yú’İÖ_*±şXT,+/ö³še´BÇ‘vP¬ï@Kcù–AMdJb£
bD•åşæ åøUy;êç$‡”ğxTîóŠ8ƒQ c‰(Ù›–EÎ‚,…¡Fw`Xø>çÅXVŠ×œQ8¦¹hÄşSñÑèÒ¯õœ‰h§xg×­ŞeÙí­”Ğ*‚ZşÕ£¾·ÿÛì@wãÃåN¬ìõİxh#]I¼ú…1qØ¤;JòAåRC™"äR_Šo[¢%NĞ‰öx¯¡çÉœÒ±;{5!™œØ¿!fÓQıx–ÿëgw°$„˜úìµÂuœFy#:ê^>U	3'a'Î€Rœ·%½7!Ëß/ï V2ˆÜãÙÅÁ“…e|$ÁxDb$KQ°/§OÑRçjŒÔ5ùŞxóH:YÜl„¶ŠzıŒ‰Ïã‰¸È¨Zã½•WD½†càz»É³u‰82¡‘ŠéÑPÈ¤¸ká^9H%M³[›ySši€Ä’òğÖìàíáxÑ
Ù­ÑÉ£ù!_£ÎÇ¨Ğ†Äq
8É6s<Iw2¥	Ñÿ£ms’­Âm¨øİÉ­ÓFÀ7ç§²ã”½ÊÒÚ%VÅe™Ş^ÃwıËv>Z¿{æğàgQÈxHÌa¨“ˆ½~I{OFt„Ñ‚¾4ÅÏà°„ÉbM*¶4{ôısõ  _EWí;SEtŒÖ¤àÂ	¨â§Ì^>Ë }ªş…GdD'çbdJ,w®O>0±Î,èˆò§6x¥´—~¯¸¬ -¥±¶ëÉ2øşux_¿ëˆS†Ì¹ˆëØÀåpFèÆpàFøBÿ&»Ífiµ¼o¹1´8.[X`W"Qş4„u9hÎNqwÇÚ³n«ã4ºB}²ÏvÚœørÓ)xÔ“Ì¢$J&¦C±Kl&M>õ“·ÜwÑÃû¤({Š?²û¢Nj¢'6`c`	glŞûn£2î æ<Z®ûÚ°:»@•yÛŠ]=YvîIL^Y8'"Şwtêô!H9|òòÊ€îÊ‚¹NmQøb…ÒFFjÆµ€cX„	 ï5sÔF„>-ò8ü“1ø€ÊŠÒM‘rÑÔä âı,i;¡…2=í÷P*¡üà@ZL^6™ª=—KêP©’TÔÍ}…z—†º-™ôcˆşİ–äWÃ±xs#<>ôn¹ë·'kÏg'›Îc4{`¨’`¢aÉ÷,Ïè;úÒz^ôI«X1=ùdìNé"S'Œ	ˆ¾RŒYÆ^¾>`¶U¨*BŠ—"+%^À($…Ä¯i_ñµ5>ßœÔ[´Ó'ƒMƒ7ÔUÜ†ë£ôÇyJa]Ê³Œ¿¼ã‰Á\ÍŒ¶…'ìÈ+Ğ…ø°LéüOº7â¸îX[”Ğ"c¸PÁ2Ïw`³¾±¹WB)\YW€õ.÷&)LI ßë™ïqú=/sLÏ2C@ˆéº«­bY‚şZQêU‘ª×ô°a±óD(¶}XÕ¿³_ÑO`'0;*@úÜ WøùşöéFk–‚D)§®là·lÀ£µãå¡PĞã½$,æè9tÉëÃëÔø]¯ ?z¬ğG{ƒxw£#Ig¸Tât¼D„·Î=ØJ_ï€9Ig¹oà÷(ö·ÈÑ-É°ŒqşBN§ó·*Úá;‚€ò/¤¸¯½#§¥º|ÓÿQ…•¡hğ§Ûô=&‹D9îuÜA$ëGÒ¶ˆÄÜÁ«o3Í¹H¬Ÿr÷2Œ½À9³ªÅTÏ/	ßÙ"W-Ñ*uhÉÇ¦Ÿô½)~ŒAåO°HæáÙ“ç:~ì±‹ÊJî[xj!D?ÃkÛ"«ã“Âm×AÇO›%ŸM DT±u;¼–i½Ç!ºóàå>çÊ÷Ç
[¼«móy»¦»ŒA¡}•o†.¢q3[vwÉeËO*p-Ì4BÓ#^cf±ñn³'Û dº;„şáõ \:åÒ˜eqõÉò$‰óm¶’CY`°kÓ­o†òuÚÿÕéÀâ<U±i!ƒ%k0O÷U®k¬)°å–ÌòTqôt9Ê9ükIZDÔ¡—Ò·sÈ~µ—}êRšiÎÙÇ{Ìf`ª}ã¨5sÿŠÜ3g—ÑŠ……P•äïÒf™-ÅºÊO²¦÷C
Ñc|„(
¢å‰~ì¬å§ñÙj_Ûú [;Ë‹=ı ·+wÄñîæŒVVFd{
)~>­w¥Ğ³$))ˆÄ5&]0\cgŞö÷®8	İçÜ5OŞœ4W°ßß¾(áŠŸ÷uÆÌRfJÄ´bRJñè^ÕH¦(<ÈGî™uÌ[dõ€¯e”u±óòâ1nL6òBæ	O8‚¡s«ñ©ÉŸA²—ªçgÔO'˜KÁ2Ìëÿ–pu¸ÒsÃC¾BF>æÁíÎŞ›°ª\ı)ØoÕİ‚Ãâ=y6ÇËJÆßyú.„<ë4ı„Ğ\ÖîNeŒ“1Ã8œ5_¡Àg€µñjz¹¶ê5S'\¾ÂİÑµ"Ìš„…;±p­}÷qöK6•º°ko½}hĞøUã[Pt)¼é–j—q°,Ê"K}¼Ww×LlÄ×ÛŒh¥÷æEÄÒ/	NÎ(Ëìªw@ DW·s¾ßúä'œÖYõz¦cUcêZŠzûl¯Y‡kk)ø³¯ë­z/àµtv­Ä[gêêˆ<?œKUìşˆê}ªûˆKZ‘@Ö2|xè’–Šêşõ&,kòíõV$Ö*®£fùÉ dU’.4³Q œ‹†üŸè«ÆC^~EOõJaSĞÖÖ–~YÙ£º3<ªü‡…’ØN¨¶¢|J!2_+®ĞağÖü%¹ÍÅæ§©Gap(¿h¸rj~d‚¶V¸ªEé€Y¯î·İ0ƒ/ÃUÛu,Ê÷Š79qª¯™Ò†±Ö´¶ÚÌ-o@²Ò¼•_¤šr‡äƒ	§TbS
<jÚc1\nÄ?SÚİº‰R¼YİÇYÔy«Š—õ¡èÓËÙªÃsâ.’e¯nû¨C7“Œ²ıútS¥ıKR'˜o0ËHh!†‡y{x„¬Xïœ‡£ÂÛeãÀx× {F_Ñ¦«¤}04±QÃ—“Å¥1ÏÔsdª‘i÷Ä0åoìÖ0ƒ.[øt{šºq{NX²ƒ~4x¨»ƒğ›ûáªO4<WÑ—&3 Şí¡V¿/–½ñ·M¨¨Ô°®à¡ò[íf‚_lá.ñ&œş(ÔT¾€¡<¸Ø±—Ä€ióUè‚Ÿt‚0«U„n„¹w0e^AWS’òÉ×¬ÀŸAa@$ÍQe *PSZ´iÿAU	º$2×	Ú%ztÑœäå¥E¨tq…Øf5y¾èşzNWı'ì;¬½“ê¹–ss.‹|öÊ¾ùıÍ~3ÌVšü»ù&Æ µ×sïk“Yã3ZcÉ²)?ºàP'»jÈŒÙ›¢+–)†[,ge9›*­½ß¿_”¡æù¸™¡’«U É’“,ê´ÿŠ6ÆéA­±”šÕL'7ò¥F1ØZ:“æ:ÜĞ}µEáş›U®¿¬ïTıeóÔÜÉ„;ÊK­H(Ö‘ùáì”ú1/\õv\‡œ§)AJXH¼¨	YñŞ¾Îb°²„è˜ÏÒïçñÿ¦~}jGÂ1öúCğ©ø]ş¯)Ú£1Fç:lª#0»QN\ ,V×Òb4$›²û]äVO#c¥ô˜CÊ‘…Ö2*àc{¨×Xv–=Q†ëó@ÄÒ ¹^^5ÊŠ±©!©C _­kè<ZÇ „°1éÜ™Èîq6É-®İäÂW+Œ©°ÖZ¹JÊŞÓÑvdĞ ×ğê;ìÜfóÂ&í=zwËûÉu%Şò[ä§ÓNşPšÔz ËgK&Ş¬Áí†%ÖyWÒÆØâ3‘ĞÊTóÛq Ôq‘J¼1œÊ;É_à4 ô))º˜Å¨ğÖ¡NæYªã¢Ú»Uš/<Vã¼Ül;xè<WÌ/QÚ.ªÚ‰Jábœ¢èuÉ^$ÜØ,;=ôÒ;l{† e¸f\Ø‹„»6ÑÖ+R{œÑ‹Uyª#„¿t¤Ø\ÛÀp}
šH¯vIØN×=Í+„*Nû!%ÖØ/gï@­yùÀí}&‡å¸câT³[tr¼©¡Œ¸óB‹]'0ê×à8¼Û÷ÆÅÅZ_~Øjé›˜"°Íí;»	 ŞWmß.•dÆ%²1³WñmƒˆÖœ‚¬Pêe?ªì'ë5‚¡‡¤§ÙPcù¿È ‘¹u}ªî|ruµÂÁ‰û£¯1îódĞ€[¦ìvÊ ¨4+`²˜fyõÎ$ğá[à5ûŒ€/‘¥‘Á±ñÁ@ı—RùDy…çp<\h_ºŒr~pfùeoìıúIG)Ç†‚÷ö¦˜6;.'íì“Ğmÿ‰Ë§*ÏÓ´¹œÑ(? mEz³ÕËM5òRÒ9!ü¼D§cæ\*0$Gr•»o.ï)U¥­ÁG¯S ğçäòûî®^1 pcÒÓÂ¨Úè°È^
ä«ÛÁµA½6)Ë­né™ïi °De/^ĞŒóé›PİCg)wôôä²{ö-‹¾íĞıâˆÕÏÂV¹SßD“ÅŒˆÀ1Ôeplììgœİº•pêÌ¸6Ö§Â¥îÒM,neYHÛÇ]2,úÖ×­x«¯“~”Ï•$<kVFó-V±'ö¦œ]5b"^6}ÖÃ|æI³lú/<=
ŠÎ©OçLœ¤îçN/(š	ßä<ù"‡¼%3‘“ßØ5”§G8Ušš¯ß<8Îé»hÜÇ|n/×"ea€¦¢øÇ……£n—T8–;Ş UÜ×ÃÕs#§è1r·ãD±öZƒènñ@e©©M‰’]ÿqéƒ³XŒ÷ÃµòCµYæÛÊ³Ñ¯Ş¯âoéÛ¼!ëd¸Ù~izFîG6ïâ§ Ì¬ëùŒŸñ9cˆ9V#1e?¤}gÒ_X©RgƒiÒ'Œã·­mI/ñÏ}ÏìĞ$¼ûÄ¶Åx(d"ØO™Á´´KXX\Í8·açb¸GÓ;0ÔĞßŠÿ<M!Le<„¸v¶Qz TE&v¼ÃKÕ¹‘u<šË¼üÂväïÆTç g sÃWke Ë%UAs:‰š¥P ¹¦ªRÉVÛFÛOSó:Áµ5È¬
Ê~Ïv^D¢srkZOÔÑù“œxÒ³dº|ïkfóSÚ!u»yãÓM¨‰|æ­ëØAVÕp¾†*•Ó’İ#5Ğ5 Ós(¿¼­óáäÕ‹ñ³B$aåÜØ—Ïü6è‹Ç+¬oÚ(¡aæ³pıÖ¬vï·Éš†8ô\;MÙ…ı/õÃÕ^¢+Çvñ†_‚B€–›­Œç¶m/>áR‚Zà.÷ÎuïRàü½òÅLBˆB"ä»—`(¹Bô²ùR¢B$ÖaÑ†
ÚW²),â2¨­£Ú [T§°ÎPy©Ì\ÿõ]p\â|!£¬ª@±³òÖc¬Ñ/Õ™\Èa$^ÔeIÙªğ<Ú»«°aI,ÿ$ ’arëæ©ı¼WÁ—7İfğ-¾İ»ĞÌâÏ÷,z‰Ì\KÃøÈ’›ìêõãúñF Mg³ÔÄf"a}OÇİÆg®m¶ÕÃ(§X2lµ3ÓÃÎûäOà}î;xk1.q±ú˜~”4$X3Tã´—Ô‹ùgˆøéÙ Ö‚åC6’¥ºóUÙO5Ã³Vê$Ëbû¬¾2–ì¿ß0†®üµœ½È9†"´´mİ¯
iÒÖG8¿lWˆ­œÌ°Ã²ß€Òù‹ût¡µ×çş‹ËøÑB˜ÊlsöàÕËUhß~’£CBdQ’9k }˜8ÛŞ½¯}+mˆÍå‚cÆŠ,$C)¥[ËrãIm¨¦fÕìÌ–8ÕÄÊ.rWÍ\q! ®ãº£ïtŸoM—À¹ŠĞ¡ÅúÄãx.ø¯÷ ÿú$|˜.BÉğJL%nD{¡w²t$qGWù_O§Qj]‡Whİ·^(¬ç•Ó>‹YtÑÌõ4ÂôWÅkÅiÀ=„pA;ÿŞêÌÆ–ëŒâÑĞ„èT
GÜÈF«úêîIQşù€*` 'êRS¥÷ËÊBáGDÒà8|X¼Yv´¯ı~Ü—pfü²;†'OäN‚üÎÄp|™c_Hyå£	öÜhK¿*nuŒ¯¿¦šñõÌ2]ƒLšc#œµ$Áª¶\¢Ñ/­ZS·ã¿nÍVÄ>bWğ¡g±…ßĞÓ‡?$„Æ5ŞF§…¸„¥âF46d6+”%û¨ŠOcgIcë´_s˜)qß¢æñŞqƒxÊ!f¿²êù½„ø×?ÔÄØ7ÒÀ‡T¤xìHU³[ÃÊR'éûd8ì‡Ì@,kŒ~Z³ìç¥A;ËæÃÈªSRòèkÊ_#¹(ùğŠgƒãsİÏÑÉ…÷•Ê‘»ˆ¤ÊÑ»µÆ—ñ+G‰¥÷…½uÛşh€-(6O[ö8Ú|08ÍÇÒ›]xÅÅù³Ûa:=[I'Ây55 çZ¡üã1«Ë/‚×!‰ÆÕ
-Ñ\–ôw¾?Û%À–»kf6‘·Æx;¾m_|$Ï Áç
3» v}¡ø«q]
V,?ä#¦ü›bp@+3O‹‰-Œ@üæŒDQòSšz—ZKy*x’s#¾¾Q_0æùæeùvû:MéHx£_\é“êìfÖ9ÕŠ[Tê%Ğá&ÿ¶x©¤3h4½.hrË TÒ({„;ä?Ãvt!¬ÄáÙŸ-‚nÙb™ì~¨áv‰’9Å–(z5—4› Àj¹Ğá8ï¾ÓíÏ‡ÏıevõîCÃ[«Dƒ+VY„€pJ60©£C¸Õ´“KBhg0¬ÊIuõ·³¿>JÅT÷‹„	Pu·æDÿIğR"Ç.ñ°Ÿ<L«ÒÃªI™²§µ#ãµ`*-Ş÷(G¹Ù‡™§<qµuµ&É’Ïx†tQ•]q9Ä†‘—­Xºèû×&C ¤kHâ#Óc'İ…ÂÓmV€÷æ¦šÌc d[/Ú†Néa¸‰¸MÖ4TrwXıFqœ}„‚Ğ!/’÷6–ØÒ%kr·?~Bœ¦Æ¸IÅ‡˜‹æZñ„K âš”›³Xü¶¯û6vŠ>öDz}geÏKH·—sñw}Ş¿y ìõ[åBá"§÷TıDaù˜ÒÙ÷HÈÖ<2ÈM³÷X?ÎWU©ÍÃ®~L‚<¶_fdú¶Ânå|¢Oî6{¯67ÚşIæd6Zdmæ¬÷íš'Æ½äƒ‡PMšS+ŞUøÎ9ã¢lÜ.õê
¿ÁîÄ°®–?¿	¡gzô¨u%$k ˆ\Ğ¡mz¬îfÎ16Ê$ÎbºVãÕi*u5¼†Ä°0ª@uhñ’xı²óXI4ßÙÇoå¨ıõ6ÔRœŠö#PCØ³äÕÌ×?™¯oÜŒ’Vu!hl¯-Q*”,]‹yä~‚DøDD±?"ßwh¸WfàÃ˜HÉt«á+ĞA'm-İÉœ.boân±0r„°Õa:öÿNc<4¼ıÖbVtlÇè“C;î0zAş¥A2ÃhS.bNì(Qõàqù¤£Æ®mÎààçÚÊnËÃ­Ñµwç®ƒî;‡ïíéDhâeW¹†|ÕæA`©~y+ü¶«6S{ïıt˜ŸÌğN¡nZ	İ+
4Î^V—Öw†rüÅîÏ¬·;ˆu3ó,Û×Â6¾å‰DğÛ,Õ¶Ú€µoé¿cÀå«~ãO*ö—;‘>³€ÃÊº¿_ú lvHNB¾ÛTáÈåÃåäŞÀîRü‘¹~ù¢­°@š‘—%ô­9DETGï±V,pV5¶õQûD)
gBØAğKeª<ÚZ‹[jH¿Ò3ÁÖ?®
,¢ØÇ&ldàÈoƒú:ézìŞ7Õ„kìjÌ›`NÙÎ¼L²ïPÂ@ w½d'õgØtlM¡ [İSBRË¯>ˆY
#Oë¼Ç§~“´7CGÒ¬ÜV“|Fâtş‹Cç"‚‚ôrl¶I®T°¾Yñ.ÏVAÍ[káá”¸Œ	`t´İaR’LgD[ksÄù’	 Å‹ŒÄü¬5=D]úz/öÄ¶+¡¢Vy+P'!ôT?¸šLç„æúÃïY|ÅlôÚ{x#â=•>¹”JhA®.U€³yUW=,ë‚AC´ƒİj‡™×DúÄûBµBÓ	—ßV¥BÿfTà”ĞŞZÃz„‰#wO×\ş9KôYyÍ¸Ì®ªÀ™='E½&¢¼m'¯§Áb ø;,§s±Æd@İ@:ØøS†²¤Ø†·7}½’ d59%3’VT%}LÌz¶}ÓF, /Î>fY9š­Êîï2ÔïšeÒë1ÈÈì =/0w¹°MD 0™¨H7	¶G5ûXÁÁT„&mKRRF?™¥M6¶ó´&ˆ}€u³6êpzöCÖÈ®Ü6Õœ»÷Íİ:	¹îàÿK·ğ¡4,lÿíš{˜(@íïC
/¹&i˜˜äJo‹¥¸1ªRä:)%^
Fé”©[ÜŠ9–fôá6¸!KB{#QÒÏñ_†„¢]ÆÔm‡§„”A!ÌWcÊâ l¼O
Ê!]‰G¸úq¯V.ÿíÿ°ıBºpÏ¿iogÓ‚<©“àÁííaPæ7¢IiRs¨‘U
”;xÊl£Ñ”³’şë@jì©Ÿ6¦k‚ğšfŠá…ƒ4Œ0Ì„Àrüé¥¾—V ÕZÓodÈ{•´6›5)‡²÷‚mÁ{•–ü…VpşjÍ¸¶ù<À°5¨!2®·M=¤Ï4ŸtfvÀf:´ZÖCoé¡¹»i™ûùG¬\¨a7}õıÖ!âYFu†J´é,êåÙ¾øVVõ ¦t¼èìa«æÆ½$MBæ;R8³Â2u©°L§g½£ªBws¯*ÑEÔ÷„ãI{qó¨9a€ÌÁƒßÄÙ˜ÌI¼3Ôeì²ÛWw;„å?¶N;ˆ }8q=V%ë'a*}–qhšª¯ùÔÕÕúçC,Ê‡²Ôv<è7ÀºÇRŞ¡G\'íİ¼ğ³ß™8Ór£¦N!yù'¾pg© œZÇR)c$£"£Á®èôÊ}Ğ³:zÃh‰‹y×SÖSPõ7£ªëñõô»¬øÿòÇÓÊ0kq$Şv"»iAvØ»DE½¯9ŠxõÏ‚ø“€
+Íìğ½j.Ö=Äİêö Dc°ğÁñ¡ío>…×­ ÅV“	$·dRò§S5ú«9:ã**$¦<š<,·Ğ•Tø¶B°6ïA2êÒwŸ€úü<°âÕRşh’áUõp+;ö>‚{#Iìîõüí½¼i[àø~ØC(u==='ğK¾U«–Äiÿ÷ÈT_-@‘ĞáÙ]kùû¨N~ÈóöKæhmâÆ t}Zó?ÛPs$ON¤¦ltû®ÉÆdAÉ‰_ÕåëZ::éQš/@Z%×³’"B¼×™±œ2±q+Ş2†³cµ’æC~uióìÇ±¥KÕ¬2ìŞ†@Çêr˜[ş+yöç\óé'ïa Ê<í…5Œâ]½ úS»	­/»¢'H ë%‡ ‰6Sx*Wƒõ³)^$§¬u—¦-5A]Vp§ÉĞ‡a–‘’UºóÎD5rğÀÎÔ§6XPßÅÅÙ7¼¬„8.hà(ücÊQgc³«Z|We¯=ÈæjšçªhÖŸÒ M¼îK556TÉˆÜ5>TbùÂw¨‚«‰ê>ÈF»¾MVÊh:/Uˆ$à*i­>Ä½=3>à¤=ÛŞÁä*À±×2k³@ë?…€ì5é”!xòÎld5^§i;ò3nßyótT8³’Ò‡^†Ó×yOÚ¬ §àƒâ(±æ½Êì:8	w°K€í\Z­Í¥×Î}k‘óx˜ÁŒ±Y‘íA§ˆP$…m‡‰‹yçÜ­ÕlZplúèÀ†ßöéŸÂ_;kææŠ3rå4S ¡WácùTä¼ û˜ŸÎN·¸ØùÄ¼É¾•Èp•‚;“©ÁÒÉF—§ª— ,›—`wÓpÍÖæ¨ªuWõ³&¹3Få6'sR¥UÊ'*´`jˆo	/ş°VÆÃÓOU6Q.“OU-÷æşÿšhŒ%
T_‚ªÿé¯Ù™ÏµÀb¡,›«O¢â»rÃÌĞR`qŠe“ Ì‘Quƒe&CÛÓ8©i¡G)0­#ø…&•G1Ÿ”Ês
ƒ£E„õóQŒ
ô 4·üR6;ÚÅfÈgxBµ"¹Üùîbë19,Ô¡jëq^WdĞD&÷­Š¼6dÏ°Ç ¨çM¯4XÔFÃ¹ÖTæ÷ıÍè&¾|Q²4SZ2ÕgÛ“æ ù`bSéKüõ€;a÷Xo•äáÕJ¾Ë•*Ç1pé!™ikÏqÌ°ˆQîv¼OW·ø[µÕpŸ¶à”ºéMÊÂ°zdˆÑ%ÇWhCÍ°
öU¢®'Õ’pjÑOºî¿—íÁ%¼.s9æé a
4Pú½¶Eás£}´^™ïB’R;bÑ¯ƒ'kÛ„,·* 	ŸŸLÑ>Ìı± ‹Å%³·—ârœ)¥&¡ÉÓ$íÀåì±¤ÙHO»x¤ŠÏôú(C—$l¹%†‰é•#ÛçºmŞw€ÖëàY¥1äÄ¬ò:j¯$Vè³ŒèH‘óĞ¶k°¨2­Îl±Ìú™²$¿7Ü#l>Ûe†/s;²ÌR%Œ÷Ââ•'zğmJò/LéNñ7xªcÔ2¸“,?ÂŞš°’p*ñ~B0ìX#\ÆË-L?¸T|œ|Ş[[5j¯¼KGq}Ú ÈdL¾‘ú”LõNmÆƒT¬gó÷^KS“Ú++÷ø-V¥	JIƒfÄ›„Rn‰3J’×¹2í3ûK}²<†BZ­Ö@­Ö”œVn>EÍ±=æ)bÖ«†Şs÷;‰¡?qÛkG mp`­‹ÄıÑ…H‹¦²a)I¡XßˆÑ°ûõ§j;˜œ2ÄnÓÒœ»ìK›PTäïï
"*[ÅA¨ÏÊ˜eh’F>Ù;‡=;Í,ŠpO®K‘f[i zPãÏRÂï~4İä·?|˜]òe+lå+¢n%èNıÿ€1ÃÉã°ÕESïÒ#S]ˆ_³2Qªs€RGBN•zoV[%ÓeÃÅ·öN3åb»Ë~†Šùë’£M¯Î —†Èa»µëî!Ğ™?Ï¬wµ¾xGò~Ô\Åe“Yíq¯0ÜÄ†«kÚ-CáÌÊ]%HÖİŸX9ÎÊéñ	j:v#îÉÄşsÁRQ™6oî]¶Î<-²O%M	.ÜšŠàÌ/ïçÉ„¡¦@MZê˜PâÊUòé&İÚ?Ì¢ªÜ²(-±#øÔ®­¬BCz’Fç@+“‰Šìu¥H÷YÙŒ*$ºƒªµ%T“Úp¶js1K6ÖøÏ<€…‹ÛÁ’PÄ–ò´ªUu©õ‡oõÓu5O	sxaÒ”_mÎ{[†IÅ˜”9¨ˆ,=A™IòO¹K”–ØB©Ëêü#Ôyo0ëW¥—xo¥Š-SŞõŞc #ãQ5m‡A!Öª€]%OGc5êªP“°Cşã›9gJ »í‡ £<¨ Z÷ôôé8¥ZËˆÁğ´ÊgÉ°=ï1Õx=XveyåJ—Ó
¶qÇ°MŠ¼´¼SÕ~‹”ïÇøœÚ4,”}·³’iLQĞUÚ…ƒbùÏªn¯¾×¼Êi­:âõä/Ä‰2@ËDÃ~4ë?+àó@}-ÀÍX¡2cb={¢ÁPO5¬{‰AĞí†¹‰‹ó‡—Ø9Lğ@A'Œ[-¿o«ÅÆ1[­b\$f< £ÎÄüaBHaËÎÉÚ%ÆÅZöÈ-JqÍÕ&hÎ½B}/?¬¾“DE­[?Ì!ƒä É¤\Üú¹VÙÕ%7†C±xÁ´bNÒ…‘fÔEĞ„•ş4ŞÃ§×ú¼Ü”˜êÂ¯kî#B:ı<ƒâç®]-';efş‡>½îö«Y,“E¡T(şmß9Õ¢·¶8X#n€ËÍŒm1¦^jk¨m=ÂáÁÂÇ7…ÙŞó <$å‘å„W/UáqCÅ¥“‘—Ú*õ]ë\Ääãµ{â~é"µTœ,†}v Hğ, 6;ğ*„›\
µ(ï°7HYÅïén%"Â«—ïn¥QÆŸÃy]}J5R†ŠiîµÖàfL0a£Dãu6gN2S9]VŞÕv’wZOR1·¦*R{:3/$%Aëg•¾J|q…‘|ï~—1PZ¤\Üê%æ«›j¹Œz· ¯½¸WpBgM¶©™‰¸lkEä½>áˆ y<;7ò¢ê0$›Ğ€Ñ­ŒHå‡´`¼Æ·¤\òÛZîŒÿi"¤µ—# }Ñ~qÅ–‘ƒàÉy®“Í·Õo™ºŠ,FÖ3ì0ånÉ2hJ)å&ECgª–$Œ¢ˆ7Ãh³íÔ­Ì³Q ±[Zº§Ú°-EƒÑï½F<¦ŸúêÒZö¨‘FB°èõ&ë­?”=¸ähUa8˜r=6û^}Â¹Õ®X=cä+yí"Ò'}’Ïf=*µÀÁÀóœƒÇ¶Xã6€úo Î°SjM®³«°ûÇ€¹‚BÇ8·iŠu–=,×‰u-" ï9ö›V3ÉYÆÓ­›Èy±>¬V€÷™á¡œhZôT[iºRtbwº”7¯òµ„,‡~%ËnÓ_dù[ÈRvÚ[3 p–‚ÖÅhÊ  æ¥^½¸b-Í©èYHâ½hö`Îı*ÿF¬ å 0ÄƒºÁÚàéÌ–ä¶¹6‰B‰Ïö˜¼LW\vXÑ‹äwr ÉB—-Åh×«g~*pã¸ØÀw¸»*ôpY›üÀÜËàqÃQEõM¼ZûUÆ;Ğ-ÒİÌKØˆ~×A}9Ö‚ø¸û,&;)€Œ’­Í‚]MA«¹qcA®âòxœ{¹5Ü;£++&Ö{ >îÆ3g˜“Ig]z%xØsÅ J Ã¼Äy0[ª¯Ù¾*mxpEw~”Ç»Œ­õ{@õèËxµ¿ú.¤ûXŒÚ—FìÔR»{'6¯ˆÚİnÂŞ5å<]ëÎŸ_ş0!™”Lô–>3aĞ¾YP‹¥¼A\HÃÃ£üu³;¤€Ë»Äàˆ¥Q-Ô,cÓ¬“.ÍM7ª[0@ÈJFçz­m‰8Ë’TÆë _yF@p-³f“ÜÀ„îöìª÷Š¸‡t 'îbEWÔ ğ>ŞV· ‡N0Pù>Y(9Œîî?JåQÄ×wâ}ö£ÏMù)˜•ÏN‘è›:x^^ñU„Ác§êht™<´€°ÑÁ¡RD¯=Í;–ÕÓ–X™úœ‚Ôùö-O[@h£¬qÿ;&³™’Uf?‰ôóÕh×¾0Şr±*„0*fÅ5Ã[ÛHvõÄŒœè»¦-Æı–¼&•c®(¸„³1öşz­—÷† J{ê7¶µ<dÓĞrrã9ºb}Ô‚¡|ğŠÄ‰¹©˜,sÎLÅjæ·-ñ£7ÖôÔ˜’‰ òu>8mŠ7ã­~­³É›âv£¥;´®d c=ròU„sØ•¼‹ €Qf³×*
‹nI…ÓÒÁJ•1 ¼¨Z™OÀ9É~È›ƒ¦™Ki@áñ`+HJiHï¥´2)–˜¥Ü•§"ÿN‘ª›û´MÏrï8“ÉşıS÷ùG;Ó, L´®¸gkŒQ‹qÃ¢ôÑä™Na—Ğ£ŞuáÌ&ÍvÀÜVP–k’ëE
tuüzbÛ\lÑ¢5xH¿’¥Ëh!_ÿ<yƒøpdƒ ´¹x•ˆaóÍ•Q¿–ÍCäò/–ŞV×â~ö¿7 ‹iSXîÏÖüôB[DDO`¬ğèJ­OÆÓl},êƒ>("Åé³î·cà¿í˜¤Œ‡49ıĞ¨±GõV·.O>˜(»QkY÷¹ğ>³ºößöª€?gªØ[fë>Øÿo<#¯J—¤õ­éQ(	/k	––ˆ9=Õ¹{v©’Òßê-ŠmÈ¹º]^0]uéı*İ;R&cUùÛ4jxG±‡ií}ü£k:“gÖõ|?ï(€‡)æaãiòò5“ şPjµğ–˜ÃNe~6u‡şƒáø—åŸi‡íx"ÕÚ“@Ø4šR¢aêS./ˆéQK®¹Vœq¾c%­lbw“ĞI˜Ê¾•Ğ®+1êóºÌM„lW™$¤Œ`0x0ŠLSb™œNpéå¤t¬ä¦(Ç6(•+²V+	!æ¼¤Cù}3'CmUA¤O|¿EQG]Æ1z:PI®›½-ÈxşHÕ™íğw1â‰Ä”tu¢‡)& Ø„izúã2øi—	ûLñÂ?IAz^¼Àì9„–HfJ÷-)ÇDOl
Ã¾?%_JG ƒ]uÄ½†Q«Á6¸œcÀ»ä‘Ñ:.+‡¢³*£$ÂÊ
›X<'£ÈÊÜ{
À	[+@RÚ¶ÛlÈ1å_K<§¤ü?kRw¾¹Ûx¾{—«Í]ÿ÷~ŞÍF¾ËÇ1¼ŞÀ¥-|uŞ˜W3º…A€‡Ì…ÿ(’OWå*¼Á+:Š~âøÒ~¡ÕT6•ÜM›NÅƒºm²Ò‡»şAä§<9bc•kIà£ƒ|fŸ¯eqÄıh$=7	¸©@:›Çø^Yáõ¹÷³ofD’Şêu4ÿ·åõ.Áå[4;?{|ÇivHCaJåÑÈeÃş ÚwQ+¨ÌÜæ×ÎºÄÚÔJ>’Á¼Ü¾Âw'A±]åœéˆ‡ô%íwÍH~OñDø¶®MO¾Õí€X+]èÌûh[7gsşûí ê »2UÓ“ı…ÏtN?Ûx\{úä|Yë\
í‡¼pï|iÛ„ö¯HÅC5ìò~ 5CÒ¼TNîÖú q=Fs8¬LX_"?s€7Ü•Ø#—Û°1.Ÿºh–bô¿$Š[…C3‘ŸÒúºê]ÃgC†ø>WÁ·Gë9ËçİÌ¶@œXø!ÅxÙÀ9hqÔ6ó½7BÆ--	yWí˜áPé¸çÇÉJ4N%8IŒbZÊo®*÷›
@0ó8\ø'ÆD*ÈÆ\·¡´æåÁš6<0ÇfLEÕëÃ.L¥ŒG-›	ÀêÇêEæ«=¡RKşâEìèO4’À‚2~M7³Ü,XˆA)›ˆ¸]îx«Å¡{'b‡­1ûU<Oˆ* \L#„F´ßØd:rúA¼X2LÖ1ŸSO¸[ZwÏ¯»äŠH&İb4ÏLbRj»„Â+^BŠèí6T×ú=w©¡Ä qÀú¨îÖÏRï\ŞÑ¼†*;)ŠÕ´´Iğ â«Uö°Qº*‚Âï«Ä<¹®<ÉS†%aı ÍÇÚBÍÃ‡¬X‚Àazjùæ6è`3Æ •
áÃA4PÙ÷€=Ÿğ§òù{tR9qä"ª)IyêŠş;/•®50)nğ Æ3c÷^n×äD$º¥×®:ÔÚô¾#¼È½Ş>\à.cf¥ÚaaG¼ë fúNÉ«9çj£p²™lrJJJÒ3j¢Èúï¼A2b÷i8Î¤¥#¤ÆŞ?ÂçÎ¶çˆ#t³g½hsX+—æîl¿ÈUÈËGé…®Æ}vEŞEÍİ+­·¡ìÓQÿ­,ÌŞ«8­¾«¡=Š@?eR0ùv8ÕË<eÆ7Òt'åLp-/Wlq‰ŞÃö…·RÎÆ½NÈ¢±X¤ÂV“ì­ãƒ¾(nÍÿÖûGÎø]/Ã26š„õ|†òÈï¥ßÏÊm?é¡ŒO¹îä¸¤?\ÈërvJA—µÖç3Hˆ‰øà°}fcæT†–†›Zğßw__$ãÉİïaw¯š—,ejØÂ-[*zEnæ	ó¹kzÑT‹bnªkŒt5{¤ã\<¡t.âá/í5¾åµhN™°ì€ÓÚ±èp×¬µû}ğCb_ù®‹Í•Ïôà.A²Á~Éœ€ÒÜ.lĞ,"¸kc?õáÇmxàŞzK†ØN#Ê’_ÍÁ{;„íjP$5ÇQ°Ç-ÚfçÔ]Œ¾}a¡™ÇÛ«¸ø¤ò¡¦-`'L·¡O&Ò¼½¦îOá'¤²l¦‹İùdp ½?¼Ôk½Y:¦2½Ÿÿ£÷Àp*S/—µ‡Ö(ãW^T`D%ôV~¼Û»¾7x—Nô¥¸u«õÍ¤Qqc³bÖÈÌiÊ¶É¤îÈæ$“Æb6üû–WË0tëË-Í"ë©lMšäúº¦ĞŠú]İbùH%ØŞ!Ë%ª(Åkï½Ée…‡ë7¢À_ãv‡-ÒCOëNÇÉ©¢ íX,¹Ï©2í¤Æ¯“ghĞï°¾L8-t7nÕ†!SÜfÌpÓ/©6û°ß¹$ü6ÀoEµûşñÛÑç,uq…š^€´.T(Kb¥Üë)óæ°¡<ä›ñAÄÕ!¶³SR¡ÄS]ôÇÙA‰Ÿ·s¤g““iFÆàÌL…¬q3‘YÛ¾]ƒY½¡†‡Öva 
$5e½¦Ï{ÅŞ‹»\×ÖVU‰ÙîÆ»nÑÔ‹á9«VˆÓzá„Ü—ÙWï>Gu[¶Är:†>uIdX4"ô?5éb,d^ŸÆMú@´©¦5Ğèî§'Ó%\î ­GÑ×˜SñÎäˆùÇ(CÊ#0ğ;ÍĞyu?¯å˜¿É×Td
ì‹¢LNÎ×
,"¾Û;ŸPÅO7&)€mæÎ…ÀÍŞIšÔ°$jßv©–†ïNÇE§/*¶Æ„y‰zôHªÂ‡¶Àáˆ¸î„¢¨±0á²|â
VòÔµ8±;ó‡¦ø:§9¯h‘t9çú]%Àuÿ2QÑ÷o{\,ÇÅ4…ys-÷ngH0ªuªŒÓèx)9g¿àÀ¥ìŞä£Ñ¥]DvE™‘Nc}zêÃö^mµ-wIVvÄøÙAi"7¡n¾¸O­9§@µ9˜¶işóØuzb6C%ÓF`jRq{PĞ‚=Íj±°—DZ‹×háPåumÚ9åõ¦£HÍÄÃ{/r©ÊDeÚ²¤¿h§0Ñ»Ïw-¨İ+V0'¢w0‹ÕÏhào@™İn§­A{ZKj»„9@Ö{‡ÀOPµıbWxØ†Jy®2\¨ÁUØEá¢ƒ4¾ƒÎH).úN»¿Êx¯ º wPõ<ÖvHƒ›E¶ÌğÃD’!T¶ÛŸÈ¹§ ­[´ğìyã¸ê,¤ÖÜm¤B»µ]ŠÓ³¥åjÜÚ°óH×z	q—\v„\;İ¯„‹@:¥9ıÔÅ¡Dg‰„££Óœ òËc ïÚÜwwèø
L™ éYYa±éé‚ƒ~ğ¹sqy±JñÇÊÊ¨aÜ¬'ù±¨XêZè—wù1è¬>b8.×mú¾0²ß_2Y°÷t¼%<K¶ÄÌ+o^í’P¶W  >¹Ó¼o}‰Ş\ó®s?Œï<²ÛÁ+;oëy{ãS(FŒ^éê¨¥7 û>ñ×ÖD§˜¼­ñq­[§ö/¥Â	˜­Ÿ‹Í7Cd!î(ùçn–·må=­å³Ui&?Z©a®5R¯`A;]ëˆG6Ğd7ıºáÈü‘ MïÚsÆj4÷Ÿy‚kæîàR´Mô_ÒƒD!<h1ˆˆ>”¨]R;µÚ ë õÒ5Óùèızƒ~‘O¯ÁM²B¿¹xèÍò‘ªÙò¾fïíD¼Ê²Ü—!%7Y4ê…§§åS¾İ•»$qg—+zä¯£êÙr‰Øª@dÃ+%É²•dNİ4­ôÅ7q>»/¤|#¥ª©vÉqõ!-Sl­õ¢"öÜ@ô®¶§pNâ	 ƒóKI$U¸N+f'rÖôş0sN|ó*@‰Âx‹tN÷‹š¹ÎÔ¼…m=Xci40£Ø¢lãÛ-|Á>ÇƒZ°o]ÃÅì…ÿ6	qÛkxFzFG7ô}ME·dÊvm‡Å¨}¡ù„ÔcÎÕ×cø×k/}0pòK‡F¿ÍxºÈ'ğ¢´[3†J
»Ôü/°jœˆ0ñ
/ƒÆ©şÎ(ÁV@(PÍ“ÀŠèããë½ê…".à%ù±kŠÜhö4ÀgxÒı¬iåæ‹ÓËJå‡)“Ü&òGM}m¾lóˆ©¾!P¸1 éç ß<bíBcÀÇmR»u$¼kv2V´—u[ıÇ8ªõ*&¡Àb(5WßŞ {‚ ÊhpG'"^‚_4t¢…u]võ–Š¥>	WMŒŠQğçj¡èáéòf4»}°VqbâÔĞ(+K+PÎDÔm¬Ÿø†úl)Á{îõ%	!­ÇDÜ—…nºAÇWë–9Âœ;’åèñUI](e“ô‘Ò³ç“Õx6ƒ\ƒb¢‹z“ä]£aa¦Ò{Eê˜İ‘÷ğ+²œ\š™JŠ2N©rR·ã~KK½	øÃ¹}h¶hŒ²Ælt.Äg8zâ7ZV¤„/72Rn„²vw5›¢
z—É£²|äŸ…Ä:kƒ"Í‰è(JhbÖ.(Ü¥/VLÖç
tÅIÇ¯:r›wÀ ƒÄ¯DwÜ`ï+ş…UWR¬K‚Œ°Ôca:ôI×]-L³‹î’Frpœ1 0 É#e
ƒì„Ò³)8­üÈ–ÆííR<Y}T†8÷{I÷YuHµñíh—Q‹q*MÀÌÏşµÎA±~.{s—K^+)›8uz"ìoR°6´Åè`Éf»ş¿’·~ÎøÛ\z#Ìû'EœÙ(8\L7+&ûhÓ“îÃßì=ŒD)åe°)"Ñ¼Gó|BZÌ/Qbà›wZX?Õ$nHx×ƒt¿¢K`µ9>t»›wÄ~<b{Öß™ƒ_TÇ/¿ş¥ä‘O¤Ì ìûH×eIõ±LQB«ƒ@¼¯Ë6f˜X›ëÍ¤çtš(ª1g±{:íÛ{V¸0¡©¼™öÂàèØè%¦nÜLi¹şõ¥8Ô’¨¤>iN@æ·á¬ ½´L5HT 1lDÂ,ºÜeÃ|ÀŞ!îİ¶P2¦·Uo
o®…Í»œ2·LX&½vÜ…lƒbË¢-¾	îú¤xÔS	qZë$äÈÖq 5Ô}áy¼+\T–—k%ğnEæ(¸ç[İ¸£wØü~ÂÆ^ë]?ıW è´™»7`K†µ6*pªà“ÁÆ >ÈV•÷²„18ÄÅ$&v¤dEçƒb”ËĞe#ÓkŒ”Çnº†q«„&?³öŸÈí¬MtJ ¢N#+ºDŸ@Ü|¦‚Y¯8hÚÁİ£…ÜÜ¹WõÏ²÷<Sïí¤ wÊÓs,•é‹D)Y=ôZ¦Kö”õ ¼IQf¯VòWš/”bıaOÜ÷2ÎŒ·ÓÁ%¡ÿ· ”Wå¢}ğÉ78ùïíµ¤us¦„:ĞÅTÿ»¤oÃÂ\MÈw!”Ç½&>Òs’(?d™yßµ¡óˆú%“÷‘ÙO=ÚFº=ñu\Bx¨  .Ù0ËSªĞáŒF“İRU'`lİ%|6æ¸=a¹ÔìMˆ@ êãI`d‘î]òo8Í'½»¹XbFñK[b>“§gˆŒ¤G‹)~1‹Ú”¿?,*ôGuí3º9{¥ÔöÖ5ƒRÕ)}ÎxÉIFÛ~T¼A|«ëCÆcË¨äƒ½5F6,·[=gƒ#ß„
‚¬ˆ«ı¡}« ¥,6:5€Äwü¬~Š^”y¨³ŞN˜­oHdQ—¼íeêÎå‘òF^—,tïâciˆjN0ºÉ¬ÍéOÔ¶ğVi‚bê¨“Í6—•©Qû ‰ò²v±ÃÄİk+·YÌyh-´ÎÅ>Æîí˜‹oÄëÙ$t­Mˆ¦#vÑ®ÿ&ôlÀRöw½
oú^xÆ:ÿÇ½ôÈ[©lÕ¦PWN¶`ÿ®_ÔúYúÇŠÂŒÿh· «ŸĞbÏ€ê¥ã++3#’;·¾ÆpÅ|äÿî¢®ˆ}|+	í¥ªËXíÛS¼®d®k‘IwhÂÈª/êÃ,Nâ¥c6¼€›  —Á/Ú×ë¬®-üfÒcVÏ6+¼Ü­Ñ6,~Jô‹ŞşV£(ìëGÆ½ŒDèŞ_j,†/ó+'ÁAËö‡Â=ÂÃ^YÀ¨Ö‹1üÖÛĞ)À`;øK’{'G«9¸ˆ#JÌáˆ­®~‡Éıa]ÌÜ´»’Lh¦"´	ÒT“‹µ¥Ù=*‚ µûß[œX÷s^OÓiGŒPd´Ï\OË}'ÊÁíø¢ƒ°ŸRÚ=%
Ú²¨qì\^&i1ƒŒ4Ò¡=Ö¶r+÷×øzrÒÀô}Ã>}5Šıéå^¹Œ™x=	RO¤f›¨¶¨ÇcQ†í.Zö QÅ¦jA	´%ÈÂ­½¤¦¿ Üéîñ"e5Uæ!+q4¬7LÙçmBÂIšRbÒÒ1.¾Ù®$°'_¼t¿Ù]hG/f'ux\µ!vr¨D¿Àì„¢¤ãØBå"Øyˆ0ÓŸ@¡²™6w(¢ô<½…muoBÖp4s„XRoû¡_Œ±Ğ,
€íımø;rN+Iq4^Ëv]n¼x)zzÙî‡µ	Óµ¾ÆŒøªV×¤†ƒ#oç™¨\Kh¦9NÇãºhç
EvrUr

¿İï_ö`³¥½ÙòÚŒÒëØ\I¢^4şûC´ÓêMé0èyú&¶À‡eÂ‰ş`õ^Ù+h‘3ÆÒä˜‹6ešŒJêô_‘Ó‰X(¯&E™Ï˜œÖ À‘”5‡X±ê"fnr‘·#Æo°IŠk¼õö¶ÔÑP[?C­
Ñ]›öË¢kKŸX5óìÜ†tŒÉy²#²ôµå&·ÿèç’«mbvÉ¹>(üšªªÏ.n¼™ªTzt“ÄX,Í»PÂr’i:eÆ?ı(¨ª{¾Á6ŸG+¬bwìî~¤ê–â_œyéi@J7âµmÍ©·™[ÒV7Kƒöqß,#2İÊ,…2áYw›i@×X Û$È¡Ëk±N#v‰Å;p'
*£»+¿Tñ_©(Cä@ƒf¬{fUÓéS’Q¬ÅvŞ~•á›ıú^+ä<qørPÊJÄu–-Ùi ğ~/Ğ>["7¡Ï¢o3à@f;ËWiÄ r»¬W“æ+©)ß…Ø¤õ¿±6¤=¬ü3M]‘g›ÀéŠ´•\>;å¼Ô
ætMï@üêyìÌëSŒËµL$¦šÂ„ÆÅš¯Ã,!Õz­/¶Şs®¥Ãp¬dl¬œeM {æ9HG/Ø¹ôf±hbk$á2¿€ÈŞ7O§‰ªìÆÎ¥x9œpejL
Ò?qiUÿÙçXS°+áVÌéİ0ò@Ào¾B2ø#3	ˆÄÖ¿¶Xu^Q¾ÑÚc¹Uëoïb»6_ï-şåç(Œú‘Âu„òø8FÎì Ú£âÍÇBNRÜæh«È+L6qr–Å)}~¹Ü+B=õÅ¸$&¼ßêwÏF‚ãî*ÑıµmúNîDl¡K-å°Y9ğ-ğ™WY°©Ÿñt—;áüó&ùÜ»M¯ğ}\Ñ˜ÔµÀ«XœpíåTz}ê•\–å]’¯Gìkw}­e¨›ÍÑ#“gÿ¿Ú~Co5Ø „{æ“üZtĞ*äÄæ3Òòm3ÄVÊ» ^ê|7¶ùLü=_oÅœ´¿"õG osóÆWn¨|@¡J_1ô¦şQÊüæ.uÉ§!õQº  ‹î^:>K~ı­dl@åZ%“ŸtÈ)AR§;ëó	…_ÓX¬*}¨¶«Bî¯¬€ˆ Í(™“a‘!¿Ú0m47ZÔ`!áƒÿ„´®çn½?ßéÊ+J¿×‹¦cıŠ4!Ã6A€ß*P{K<tŒ•Å°§2r‡Ï˜ÔB|0A-e™¸zïDwÍ,lÏÿŞ×±y	Š€¨-jõe¶»ğ>Ş$êø¨¥ù}Ü†:|V„Ã›ˆ Í‡ô£ÿFàÅrGŒÀH¯Œ¸LÁyN3eÙâ’Ç3ê]˜­j%Lw^ÇÊ¡[xÅ¡åw¦#<àM?’UØ…âœ(ŸPiYâ¨Å‹—ÃOèy\´Å›Ö^Eyz³­ÅV™À„qnÜqƒ× ÙÑ:µ]ÿ9‰Y–i´ê¤UZ<ZpD0‚,86aL‰IRƒqºqT…Ÿ‘‹‰?Ó|äŞèÓ²Óc!(,÷³#ÉI=¯#ÿğ¢õ„©;(E¹F1Ï•ês3º‰çÿKt;æ£íáÀ7Ù+ëåÂsdxJ\K°
I-”¢[ì TáP«q¡„í’ÙØI«áxhËXÇ[…»wQ”Q©øXŒÁ/?#<ûÔx¸b‹—<^}#DCÄ¯eŸìÏ‡¡&-ÉeìôİIa0YIK÷HÁhX ¾i½+Şï,E«‘¢ƒÀT{‰®øE)§ğ³¾¤|8ÕsëÈsèÔ³Ş-ØìS8wvW {Á¼±¦_oŞHYóè©Ç"ér´FÅWŸwŠØvEB&>êĞ$„©Cî3Zê<F
ÅçNVğÊ6ÚQî|‚åz»°ÌBéO§c‡—­yğÔÔ2`T"C·Lâ[x…jT”Ì{‹+|+ õ;TôÏğÂÉÛ›í!/ĞN¶<Õ†Ùuøa„s´4ìíÕâ˜Äç·0)ö~hÌÿéØ•·.ÌS‘bí¢Os—ì5·ìÂŞÇ[ûˆƒ\â"Ëğê,'È½'­9·EIô¶œš…Í„¥ºZ¿2\÷|ñIØÌ~—a×¡6“û

·GXLĞòì²öMw8ĞgÌ«ğ xyÇ‚ç ‡ æ*üŸÏCB±èD{[9kÏo)“az}lÕ5pÂ¾N.õ›Ù…#Ä|í\6ÌîˆPT>•©³AB1%Ü¾TqÖò÷¾ Œ?w§ş3ßì¡r˜‰ŠÈxNîfâqMÿ>«ÀîeÆ~ñšî=Eµ 3B›ñ®ŒQi–ò%Ş"'@íÑCvxIîâ'±Ñ¤Yéj`%ŞÑ¿¬H­MccHõû×§Âåş´’Ù?<¾Q˜Ñ*J=¹\“ş0]¥š¤ -^ïÀ™­ÔòAc@·iãìñ¤ĞÜÜ°øQæˆ$Û»\]	‹0|ØÿÄ¦ó]W‚úx?=» ¯r‹¼{89vy+xØªiÛDyU¼ºÂ[öë)Úê¦Ëöc÷|Œ^T¯»2.ä K“0q=¡õ ……uQş‚¼#1*ğç #	íš´Šö,ç;Ä\6²#} .÷æ\“}ù\Ø·Ö,Ì‘«,šºïÄŠ`£|*:LÍ†2~î¶EªJ…€–WÁ-ÔæxúU‘“IœÇŸ¡Ç‚Å¤=ºØÏN“À àØ¸P¾cÖ~`Ë†(;³¹
ëÖˆ2E;
öÙIÛ¨ÃëÅ¾ì B$_³­L8šNÀóÃzLºŸ2ÖwÂQœÒÚ²2Tâkƒ,ÓUNŒÌÑøI0{=wMc²C‘æ¨UV*½ö°Á0\æfHİß3ê=ûÁs´[ö’œ˜¢yõø¶5ÄÃ…@!Jœ/ÉFbL)/9#ƒ|•À€ïãÓzá)¦dà‚ª!¶E(š‡d%upLùù|ëo¢pÔÚ|nÉÍ
Ï‰…ôEtÚ‰AfÉw“Æu²œü›íû~Ğ¢ÑÿxŸètŒö«ç¾şæ©Í2 Q±‡ËÿÃ`ÛIr“Xÿ.Ÿâ9@g¨ÇÒ»D‡Ê_W	%?€6Û}5½A¾§Á^®Ö¿©Ãå¼ê´˜U ğ.„	*Œ£õÛX`¦ûqì‹Ëô¼Ù"šÔ%H‡¡T4±—ç¯Œ6e'”Od‚?ï›Ïlm?ë	æk'·ƒ×GÖ¤“ögØCÖ´âïjV	vå"Û{ùC%Ø§½ÍM‚(qD%8â­ÚfŞ¥Ü³ÄùrÓs·#ÑšYıiN5X¹^‰z:ÑÏ¥ü{fŞ­ŠÆ ˆ³FzÈó^(™ïÎHMp9`HdKD¡Â.4?†å?b—è¡Hr¸Ù0±¾
°<ƒ~	›Ù&ü‚®@–qo¾†"ıh¥±`Úk©Uà1Ï…ñ/cs¨gÜ…Ùk)»ëˆû.—»l“\D‡ŸğÚJ¹eù¨ğÑz%(K‚„ã¯…„‰Ôy)Í;Sa…ÒÔíç©#w½”ä|Ùï2@KÏäæÿè(.•LW.ßs,sƒ·Œê!-4r¼–¯óÎ¡’ü™ww­Ú¿)ÂôÀ^œXÅV{Ì5ˆ}Á¥RĞ+›’OïSbŠÏP°BÕÿ¡©ÅrŒ>G\[	s·ÓMVMÓb®îÈJ€öU=ìÆÏfÂ«ƒ[ ¹x®fvï¸åóš’Ùyq2õú=R¡Ü&Ğgl ¡ş„¿Ê8 K´åÿÔ±¡·Òw³¯÷&¹,º4ÊšœY"–jæa¬.{‘ºfÏ/€÷I&"¿ßêÕĞ¼á·êv±Ê±>İk§¿V¯Ø;gÿV’”§y®}^²–ğÄh”ßcdàìäâ¨HMÍÄ&z\”Ñ‘0ô–™%q¤n\{]x*‰#ØÏ¥vªO\á¤Ã×ºÙ”†#9)ğüø-¢#lî+z4ÈæÃŞZ¨m9h¨å”5Ûü·*èÿp³Æ´iTƒƒí)ƒ'ª9Ö»}sg7	3ákşKûÅ4¼x´©Ê%¬¿D¦òµŒrµÆU†HÓW§èJ§ÏFÒêb¸¾ß\»£v¶ê2ì>‡³… üîV2)ªdöcöCàµm§B$bmúI¬‡û,.»Â rnÑš‡°åJ­Ì	İ£ÃÖy9-Ï6TÒÙ]uY£Ò;­ø-è–ìäiûäÙöŞ¶¶ZÚ½3÷·WHíA["®YI|î¿%Q.q¡Ô‡ĞZ
Y§¨Ùk2E.v«½EQ\˜¾£Æ×Ë×QÎ©‘}ÿÀhŸ—1Ÿ¡#Uğ64šŒ9_ïó0®¼HûÎ»Ü-?7ñ!÷—ˆqe[Uáeã€‹¨‹à}*t#Âb>¶éĞ§oîÉş~_.5­è•¬¸É¼îø9½|{-<$ÖVqöÒkmŠY4‹&Ç²ÖÊÒ¹Ë^^­sûl&<«½ón±Jûû Ã¦3²‡p›Â»0¢·T»°§Á9ÇÄ›ª”I|ò•êáµH!U¥N|ïºÇJ¥l„¹[Ü+n‘jUU^V(§?ó¨‚â„)U‡ø
›}Ot=O¶V0ÓÖ=WïÏÚz®Ú·ìáÒMÊ@F}ô~«6ê˜œrÎ©LDŞÆfB×0‰.ıMË_eÔáÈ’å*$r×Œ¾-ŒÎa 8ú:ÿê¨Ud4k¨Ã¦š¿>Í¯¯hÿch;?õ„?Ê*«V'ùÊÌ"îRÂ‚ÖO fzÅSıºlhwÏ!~FXßğ`l›¥
ÆÇ¤€¾-å„RŒŸv@FbmÂ!Ãª.öñ†UëÌƒ¶4pü€í9^#’º);¢•öÁnh‹Zy)Äec
ší4É½¾ë·™	/ä=d¹01%ÒV¯"3Ô³ó`ç=0!Òı§ÒUJ­ì.f_³Ğ”*ì›÷•Û şK!aJ)À³Ã@*lÓ­¢­™~‡L-vª/k_•ì¸TÆÀHùØŠ¿<ïÙN0¦_'z$Y¡FOWÄl_šH"Æq’,·RT'! DĞöÜ,ğ/·Î¾.Ş,‰$­Æë¨ 	ËÙ/;Ê)·Ûèü<¶ˆ¹7®ğÓcÙÚ/–œ¿ÔcTã8cŠ0ó×ĞãİÖ‰Io`®Hæ¤7ØQ¿”nä‹Æ8àZ§’Eéyâ†g+¬³kÅXöy25ŞpbFĞ5ºVNrÑ!dKJd‚èÜó#iŸÆñ$î97“È ÓĞ‡pK;mÂ/ö‚~sÍtl®­y†2ŒsìCÊù;Ì+«¬|?ØF+İ‰ÚÇå5óğœîšïG—YQñvjÄÊQ;ws5E×ŠVWfïGß~0,¯nü˜¾FÌ?_)€?4êÎŞ_pX¡â.HK¿ƒi,†‹mGhæ¥G+TmŸ"Ä¶*œ:^™‹G+üNÈŸ®°!
gòw»<Ô}™‰º±ªbsÕğÑ©‡J¸ëÆªÚ¼à`té\y×@Qi~ÙÉ—!ä™³ËORŠ‡cznRj×èµ¾Mb4í–ˆÕ‚ˆK“©¹¸d—="&äÆûğaÈß9Á*ØfRs#‹»#¼ƒùàøoÔ(¨Ñ²!×ŠA,Eœ×¼äTf°hğGÉQÄ%¿Àşîk	'b,àé©ƒ3Õ=Nr/ü|‡¥ámÒv<Ã§ìp´'vK1Pú‚=çIÜ¨è	eì™)~óƒpZj·Gß²¬oîÅ+–=@1ËæüÚ"ûf¸b>umX‚»üÒv’â6Moñ¥
¥XP†½PWGUÒ[~Í|¿ÕøÖìbyJ©hªÃË‚(ê]™Gµ¬ÖsY}âõİÙo¾6£ùvÇšÊ„1ÓÜ››¸Wƒô1zÓÑ‰¯±2Ø<mÖŠ©ƒ–èûojæ/÷CáùĞû Ş6{>}ªù– ¬˜ˆ=ş¶"ÇB; ìşBSÿ½x4>ÈÇrÕ$Y ¶@uËÏW OŞÛA‘ßš£şš@ :ò ùÊ;ép´±–ØçV¹ŠºCæ‘}Æb'Ğ6WwˆÇj5›	Á•4Sìƒøø¨qûŞ,@«‡Ëú™4ÃØŞ#¦SQ	ÌÍã“˜Ğ4ïCsv‡Á
^8àP9)ö ¤Íù¯x^GşÃ:x§Ñ†â6ÓıeálŠN.éÏ¥ÂÓşË1˜½u«pKäD­³'G©o 7
¿Ù;vÜo=«pD†jvjÑ-ºš$+mÆ¬šy74{ğÌ×3JôÓÍyC*Òê:®\Yäá¨Ìé†#†KßÒìP6Y0Ğlëœi¨yÒ)Z½ïÙGõ_šÏxú¢Õ<e1ãüLÌ•Õ.ëßÛFwûE g°)Š<j'_â"×¢óğß‘•¿	à<Ìlùôb5‰ˆ†)10F×¢@ƒéaÒ7= ÛŸñ“æv™wê»Å}J4„ÂÈé4Åm€İ4@›ŠDÕIX©	×ÿªq\5´«›·şrm¶[õ²Ğ²–s®Ö5¶Áûnğ“ÒšL*Áe¢aª†à•o¤÷3;¥Â“Ç1Ñà#MYóòfï/bÃ´"dgßM`à§V»y§¯·l ]<Õ Û>#tÒ;;)ás/‘„PA.VàÃ†î4ÂÑ3âüË…—,Ü…n¹ÅÄ–fòĞ¥Ê6ë]Æ‹ÑÈ¸ÀÔyemÑù^[Õ < È.ñ(¯7…¿ç9ô5y{9îøÆç\è«+,s®{Òíƒ3“üK™"şq§‹Ï;3†ÜÌ;¬\×ò”`Xò›Âğq¤Ù†ù‹@—kû’HfŞEé
9‚…^?£}af•\‘Øà}< C¹˜,©¶øåúæµEä.¿W¬Í.Û9
l…î„åÔëB¥•†,IÅT\Zå¡â	î=	¾Q/–
Â|\oŸ%B)äJ`¶?q(»Ú"ËsÔÎ_1·i¤n¹e´“bPGK'v÷'æb~®¹|¯ëRYÖå§iI|CZm÷º™>QÌ0…)™úÊN¯³1ÌËFyqeç ˆ®aSAaúoÜe•ŞÊ'FÖaŒM÷G¨u@hÌ½;>n¢„q8mx|Ê¦ri_ô¢KQ†£ŒOìG‚yè‘GÈ@¶ÚcPrÉß”˜FÀÂ ê7şeVm[«…2Q—U>›»
çÆÕY¶²„¯ qà'[®ª¤w¯“Ë?^•/vSÛ•Ùü?ËıÛ¿Ê#4[R@võY~Ê³±±ênòvÏy§¿½G™Ná£BL¬ù8cÜİL_
h„O¢¹™‘ˆM6Õ–IÃçö¨Ó'¡à¼Ó–L­3ÔÍ¯u_ô4÷NÔ´gYihš„/8kçPÎ¯¨›çs'¯>›»vüŞäSÎ2Nƒu+Sé-]€è	£^iRÒ;Ò‘µâÇD³Ö5o§Ğ4!Ò/l[I.Ê\dYõÍõK770ï˜ìš]©$’/²Qˆ®ŸGì<§æ±îïHRºÏJÄôä§2ùQ™æCÍ%(àå=Îç-ÆO–õÀáııœõ½_X)9°ÈFòGb¸ØáªBòÏõ(YGü%°=$âlU=O.“1Ó`ª@qÈìrx‰ªÇw*{¹±MáØ1À(£Ù‚§û§©Yn2÷ø-‡?±æŞ÷‘»T„<(úbdÖSMğt«=Üó5»9€˜½¬×â¡h)…ôK†dFëÈ+Û(AßÀf¤¶à.ªr´íió°è%ŒÈvólƒşeXš¤=ÿŸkbQU´ƒjñ¢-dd¬—h‰Å¹c£åJ=á`q©9œj¨Z(îIÒ e¶ó°LlAsåC_&ÕØqz§RTÍy|°7@°„N%a$mİíçªÈLn§ÓG,íıÎS¥—s/£jõHéšò
q$÷şõ<]ó¡Û†…QÀ˜-SzSZS“pR­
è¡,Ñ+„º®—PY'ÌÕ„¿qX@yÿò˜BÉ¼wŸ¾E%Hä4—ü
ğI‰’—ÅiÛ¸œùœÙs3qo
_c„à	!V‹)¨AÄF1ñL®K^©LÔo¿K}
Mú›ÉCšãìö–Š]“«(‹I	-jL}áª½¼hPãÁo½ø yqc½3{˜ºl¬<rª†âIF1ÁJ²Q5ë´ìIx#ÏuşŒÃh·¯ê•W6”ìG¯¡à’cÈ£±·o zİ@ğŠ$w½Œ‡˜¶dtw·)8:Ç·åàv}Â¯á câ÷ºï*…Ÿ-`©†©ˆuSÉ½Ù·‘y:j#EÓàyâY‚÷½s%uVŒ¸	i´şL\Úx)~4 ÛË#rö
¹ŞÇ šwÔ£Q±¹Ü«¥|ƒÒHÄ€~”öxûĞ:½”&İëûÕ‰€(•·ˆî%Nqş„hÈ ïU)ŸLºÀşlÇ’ü(Ú”Áî“m(É{ıWJ­…•ï®bS¿—Ô§—jš'9:€É÷J¾ökHà?gİÍTz…£V¨Í@Ò* Éı(+?M¡(¹fãõSò"F¨[t÷0ˆrßcÛG}Ôìœƒ·„9KhüÔã?G¹îiZ{#V!ÎbÍ:C2ëÅ„xj!ÂQúËµìÔ…ùPq÷ÈÀrÅÉ,¿š1vßà-J=ï€m\BÅ±¸Ìç£>kæ˜gò™æPÓ‚ööeqôØ/ìè÷I
»¨xªu©¨3"aõUIğ;2VLp×5e“aİ5¯¡­İšõ–ò1 PW®#kí)Î	·ÆåØáB”p‡|}{± ´ïåQÙªÏŞaòZrYÓ;ıNBŒÉQ“>åü)¾…2¹`Ş"éô‰¾ù“Cj”K{(cb ÑU›¿5_îCF  ıëw»M“Ğêúm„€Îš¶ÇÌœMŒ™|Â “Ïç-.¾ŠPÚ–h®68éømõ§5zŸä}>ÓöÎfn½fVU jb/qÜ]!!i|;'+
ñ×óÂDü{ÒªdJÓ|…‘oZ¯·bh¶ôßÊß,GíAø	i;ã¡
l×8ZıWŒ}ÉQH<h¥3id„8oCàà¥÷àÊ!@Dı¾ÈlwwÖm°;t|o®ËİçN?³WıNÃ«®µİ©±!ıDóŸ„ùÜ=ûRš¿Ó¥G”Òc¯jè`ê ª“)²:‘Ü©+34×÷ÇR½J=~İQP›ÌW‘±m¢[{è\øVù¾ë¹£;yxFËÁBjÂróqïLÍÌ1y‘ŠŞToC¡vh<•'†ÑK)3¢CkB(³\i“Š3nGç¬niTÕPõÁú®2¯È±nTXçlß×`è$§²-­y?ÊækÄÍiR›ü*àº¿Ë(3Ú“İJ¹æ7jöş£
”ì*²^¶$rÜ~Y“¯ßfôÎfK•ÅZíìÕ) A˜‘´ĞÜ½NùAM?ü:ƒÊúİ&à,9V®ÿ@K7$Á°2•øK29¢ÎäI4ËÉîfò$y™üR'ïm#f*›$nÕ·ËåÎ¬ò!«€üA?ÊíA8ê"Ö-/cuºİ4òšNêİK«±Xy•û³MI£˜çTgwœ],ãÃ.J©÷äÇíƒòq‘bC¦Ô&´;uÓCº¨m¿â¬^—CêĞ
¾ËÄ
e^øı´÷%ğ¡ÎÿLµ]"Ÿ«‰¤Iœx¡®A7â1P@V)OZdÂ¸„YÑ¾aVêT{66?‹æäp¶,”hYÓqs èü©£Š2{é{ÉYVïÊ-¡újş2‡Qş,lo/NAW/ÁZ‰šşÔxğ¥w¯´ÓĞ6·ê…º^rd|‚ô€ìÉ'µ7,’†àï „°@îAºDk˜ï?¥fR£O‹ ¤x]„¡nø‘v—–#{zÅÎÀ1Ìê£˜ÇÛÑ½H–FÒš4ÆŠô8T9€fV-Ïõše"z‚¶	n‡b3àøK&-{4ú{ıª‰Œ<Ğš±Íší3´1óJ^rzß:ˆËÄŞêVØÂ©ÜşSéxxª749ĞÓXã Ø?C.5ŞZB2ôp‡pK‚ú¡;®ú²|î3$ûÒã¢4°(şãÆØsş:ÄÑÑzeÏ¨³ÖPí¼(‹´¢²§DV†V~%”<ò=£I”3ëA:æ]­lı•’š:Ù5-m>G°¡GD¼èw/èÄi5RøîŸ~¸uµ§<l«j½	Ën/"ò(3 Öa€0!è#pkĞ„Üåû±·¬€ftûVq×v™'÷Iâ5üƒ·ÂàX|ø×š>G]÷`©ğHï0ò[ÏÏå ”ëEÅvQèWç&4EhAÅî§¶ëJÄ!‡"‘´Gòíã?F,	ß^k’ªğÜ¼ÛEóÒµWA¢Â0@ıé¿YéÙl`9Dì‡]"?æ:ß QñoA–´d¬¸…EVoñ¹AbÜs²×K<ë‚WƒÆÜ -BXÌï¶t=l¡%}ĞÔ„béUM ŞLs¿×B+>2ÕİÛÅ@=Ìaı1æİIvï²m–MTïn>ä¤Á_:$ÄL<øğøÊÌ™>#¶Œå¸r`Šks’Æ^˜ëâöV	È*{O€%(¹sÛâM{e´nEŸ3}Ù8Ì•7tªÕoZ=.Q*º—ø”¢¿š’”üà%C¿'VêyeHúfÄS++›Kø2Šô¤Rıå}âX$ÅÊ+oŠxEÅé¬ËèàÔ–@ñV»ˆ6Ş¡ANÑ·$Z a™S©Å3Ã2åÙÕ¹hã2A8çëÈÔ.;ûãğø£’ßmıˆª&ÂİÖöæ©øïRôd¢ı§åL€	oB½¬Á³Jã7§Ñ#,³ˆU*!)«ÜMôÙ:iy¬»-W§WWÑ‰Y«.˜££“€°¼[õ<2å³ëtîqg½3<PîË’¡İ£ÁJŞ;Zß¬CPv¶îaã¬;Js²ÙÉŞ£[p5-|ìX¸%©XâÀ³¹rÒêğºsb¹ í,›) gë¸}‰õ²0“Àëƒ.•xÃb÷†¶`¹˜ò„\1Yì¤¾šj‡htñ$ì(@an•X9›²auîã…çôaªÜ9jú&g/tÛë]
Ú®¦pXã  HƒÖğù„Qîí´ËMÂÜóQ™ÛÿÙ`rÇ©ö$$ï$`,Å•@ø€ÓWÈW'ŠÊéé_ÕÕ0D²{ê¢[d3ÃCµÓƒÇ’–uƒ»R\H©¾TLÉæœfKmNcÈÑû-èS¥ £[Ù­Øò¿àÃ•Û"nud=ÛçÖkeÎ¡²€ãs¯Òƒ€¯ú'TM¶@ëcˆ4×ÆaùÃsÈ@–bV7¤€>Ğ—¥ÒsæædMÖÀ¢“n6V1åºıÁTY«Oâ‰¾SpO}À–”2“|ÑkØÚ-ôæ{Œüä„!i†y?ô aJn)[§-›í¥NÅôHŞ Š_êv›©{‹â ÷ÄÑËO«eF•É´ÅI5`Ï­
`FÖ—‚ÓìíIA‚éÆèåğsÏG—şMì›íj '+Jpì~æÎ)ZÕmÕ³Q6IrÄİxÿ6Ì©Z‹}à/ÃÏ6"Èåæ¢–ĞÓÑj©_P¦&F®ˆº ¢Ìpû â£èìë{rËè„	³–Ã’? H|Ü˜t3±±İæ^7w8‹tYóá‡>u0æ%°Ô–9†ñ@4Ò€¾›SWcl8¥ng§UÜ¶èõ!.X	Òëõ‰ÕÊöåÄç88®gfcæj,%ø*» {5b§|•dÄcäŠáºyîû’˜åÙµè$ávÁÍ;nÌ]š›¹_% Æ:·OğĞÊDuQæ/n€ òJëoX­Or9ùv¿5j2µm¾ˆ¾é;¥çï‹Ylü95cDšèfå8îU©ÆŸÜÉhâ£30Ò@ê%äÎì4ë¡¤;=>|…]Öõƒ^/EÊ} »ñ‡Ü'{Ol<ÊÛ
‘€
˜ƒ„èëjÜ™”hÓN=Y	O€†mkŒ^ƒ‘³…uß®·ú½?ˆËH¾¯bN)5@"ÊÙ-8«9ìKtBŠŞP’ïeD>úÆÙÉh›ÆPTÎ—òsCˆü(á¿5ƒ
ğ×Pûñu-_;\XÍÚª…äï²AÓıJ»¦ñaÑ‡f©<]éfcÒQ”íœJ/€Ê"ÊjÇ¨ÿNoS<3ËwöT—#KÅ”ì ïEœ&ÍÔF@º2;Ö¥çcÇöåÔ%ûW›JgÂ½G3J7§æèÊ‡¦K~Ô©ã_™‡”wœ¶v€;Ù2Á–Åù1¶Ø›š.a6©	=	&Ğq†µ üÛ;»<‰°j¸€”İ–ózòÆJn»¯«Ü¬ˆ1G›pc;ÕµòffÿFAl\Ë·úÙy·n S„4˜âî5KÓ)`TB&ì^?Ã_œóÓÁ$U ­\/¥ìK6'¦zuÁûË”ÂÆ±çm]÷İš¥8jÈ‚S{OÁ'Qùíè§÷ÇıG$äP ¦øşD‰öÑNd¬ˆŞ˜j­²´µ¤Ì» ?SGàŒ²|ÿ%ÿ3\æ—‹Z=;òVê²ÎWÙ$»œW¸ñ‡Myª®ñ>Q­T¬Û?©ìÛ8Î™ºKÿÌ>0 QxÛAç#Ég+…1+ôVr¤.êQ^k»Ş6c^Æ™ùl?nŞ¹½_OÁaC_[?Ğ½®L`*Ó’K\p
õ´0¿«1Ú‰[˜‡T9B-ªá-&ŒG›jk#Îµ 86şCÁörŠ;[º²’lo¶™N7¿å8.wq Ş“ VœĞCºP1›iÂø>}}w =œ±è”–AÜßÀ¶[RµÔ¦™0ñqˆS­¾N¢fü&uÊLmBÊú¾áGP_ÈRŒ¶x|GÒÎwˆÍ)mdé–ÁšeÂ=‰TH¤e{‹ã9XäçÙ˜Zõâ3y±˜(†şxñÓ§ìŸKFuÄnICÛä-ÓœtP»CÉ„Änhb’>š}QzóîHˆõÂîD¸çÈ5S”’uÃŸø÷.GL{ŸîN”ß¬JäKW¤¼ğäèÿHa ŠêaÄaöˆ¦Í÷Úò}}3âh<û}i m«øÍ¬N”TÇ"*ş‘zDiˆéÛñ?aÓû°ª¥×è$òø(¿pk¦“Vú“<ŠÎœ…ûMbƒn5jX`o×Ñ Òn¬MÄ2nÑæs5æP~É£«²OÔW×T3ÑUI›KN«mUÍ®·<lÃ£f‚/ùÂÆ”Å¿Yñú§ïLâ¢Smfäx,;Uf.Í’øåöŒ_àÌ^·›ÌœtEÉŠqº‰g+gÑÙgê…oçYÆ([ÜA3¤‚qpw*ıRòƒ£õH¹[ùû@­w«3FqkœyÇÊ!±KîÒW„ÑMXÏj'1rTu¹ügUß	m¿Rb)Ê~åQ+Ö@mêÁ6—¡WÖF{ß¤>\Mæ¯äá†==;@¬ì"Ì?ğİÁË¦”TvÖgÔÉ?~ØîG®Ø|¿Å×Ìv™.ZYÔÎ^¡Ux­Òºƒ?‹7äÍAÙäÓô+gWûnÍZø±f’jÿ6µ|
Ÿ$Ëtöá[¡§•œ­!ŒÛvŠrA[•¥Ün
ùGæ”cı[™ß¤Œ¼Ç5+Ov*{‰t`‹‡lR/‹ïÆRZ$?õ	—XÆ8Ò*t{æt¿AÆı~«[võ_ IJ®©3ÍÄÖNªKXğpà.rÎ¶‰dTfs0¶İ[OÖ`÷oËïçš~)}¶Ö…Ş‹=ìŒÇ£¦”\ÇÑ”­.M—ğ½ŸkEË<´p™”'Lšñ U)’QÂ¸£Ü¹ ÌY×€™jkê­º‡æ›àà5s ½øsGê¦c§c[˜€œğë©”,ùµâdÉåÏH*éP
æÁ¶şB‹;|Æ½·Àeud¶Ah¤—0Ï‰\ğ7‚0%àA;"ÿÇ H<²`IZw³Oùš ¿`÷¤JŸ«ƒ=ÄÎôeá·(:“±7…¦‚—c/-–‹)mÍ b±ÿoÎJ+ ´nÿOFà©)ÃRa¡q’œÈ¾EH\%•®À£´‘áz\’2Â2:	f+m}Ô'UºÑÔÚ÷n‡,Ô8‡,ñÖù·,;à¿DÏ2¡.îù_5ò+›şx6¦GMA¢Ç*ùãb Ùè¼wµt¿5±çsÜ[?SÇY‡ëËeËèÅ®îé Öú`PõÄ’9Â¦¤,0,ÍàÙT¢‹È~âèâg@÷s·—ö•l_|Ta³ºQq =“Vz
ÚJR°53³OŒB¢	ÃÄ«4üìøfqãÔ¬to}®!Ù·åWÕªW D5E‚«ö˜G¦xâEæşÈáE™#üÎ`tøãCÖNI)äqgegĞÂ‚6>>ÌDôrÛ	,©)UşŠ²PğSÀ„­f‰WÁšK”°¿Â.u`´¸­ë‘@ãĞhß(æDüGğq–h
a§å
“T}i6“÷ç
ìcüƒÉß›ŒXé•| ¬h”4#ï’:Ñr İÄûîç×x§YÀ´L5È,„¯ó’“>PL\¡;;Ô fcé4Ç0qG¨¢7Óm=åİy9És€4Œn‹ç•*tAfşx¥şà!÷…y= ¶ÈÓ¸ÿu7B‘ùlºàoÉçËœ«¥ABx`2¯R• MÁv¨'í¶ù8U­uìÍ¥ùÕ©$mèìş«È‹W…ĞZ¡}ÙEõ€GÖšì™d:l›Ü¹Ÿ¶Èÿğa¦˜M
C«“[ÜiÅ¡vš«f±e‘à4éÓ—.k%·”JDv\N.ş£#ƒÃBÜ6.Ì$Ü7ğ“ÈdF1jÔÄ~”Q<›Ö]jœjÿoTOÊ¥c–J«ğ+ó¥ËÀ¿ïõ<@vØd¨È8jïì,`öwØ:…<WqìĞ[Ã„p!òAQ†úb®5ÀÑãml¢T¡ÇS5ÏÁ…HÀÚC+~Œ!dj§¢·š•€gïÛÄ|À`Ù’'pû&kİ¹IŞ*²‹ÇXB××ûıá—{û[~^ij€vúB£}F„VEÇË^.Yâ~oåeı/:L—B÷fğ_›ğ˜j~¤Yc:^¼ ³¸„#´eÉ|Î@z‘ÿ½ËĞdˆxú`Å6y­6Qù:A6|"2@¥ŒbÄT v1¨3D¶tÂı/¥óq¶†Tç`ó€ÙG™°İÃ€V‹&Ïobà’[*¯¬WáyWêÙöa¸ŒÄñÂ³É—Å@³®ä—€¦ÿtéÌ+z0ˆ,©ˆÍª:…5i¢ƒ¢m6Œš1ÇùI…0’8ÉÏ[¸O›ËF@NØİã,¼¹³Ë‚‰Š»¹bÖåm(Èª²:(®i]j˜&´^Î),­`?íÓpï¥sÙBTÊİãíjuLß–ÇÇºÇzë+\Bó
¾ˆ*+6nQsó@Ò
0€´ÈHL$ÌF}?–Dßf9üÉÜÂÙ‘!<'ÌÓ\¿œ^IŒTZŠèËæk¤É&w]Sr«fı¢3p¹ğ‰PÌŞ*­ƒğ¬¤W_bùB·×j µWvŒÊŠøHúçB¸+±ÄAtÂpöıÊ«wÕ¶²{ı  ÅÊtÂ‹6VËªÔ/'eÀ¼¡/l¿©ÜäÖêsG-T¡a° «	f	$"Íw?Ì; /¶ˆ™Éh‹•:îÉ˜p©¡ËTI9 «“RtÉ&~¶ÖÀ·¸:yJf¡[Êe·OvIPG`vºÊêf×VÈ¦ö•/Ÿ‰ÁmÃ×4%cNO«ÉÃÅV;Œ¯c„T·¿öüveÍ>°ğÊy‚¹–S•&ºı{ú"â |«¦n•Ò@jã‰[îÄ0„zÓ|(¾—ˆæºÄŸ~‘>+=a®(pç?İ³ôI¦Ğ›œVğ»¨üCeL ~@ğºç‹Yâ'OĞân‚èò?¥î Ã
:#v«ÅY İCj
L,B)[‚x[´1‡jÎëgşüÊ”÷»M œç7°è ï	e» ¡îq²°×ÍêgxR5Û…yR¶3Ê›¾0ó¶'9~+ÜmùqemøALj«NfÚ¦æxóÖíØR5oæû²µ"ĞğÛ¿¼ìÇGŸd»ìğu»°æ.?:pÜ©5–â9®2ÿ`2ğ¦˜S‡Âh99ìv&ô`ë}î™•@Æxî¢ıŸR?aÓ*dŞ_ÖC¶lLWNû©Õ­Å¿_´êæ•õû™g=,ÂÑ,¹"¦ªÔÇi¾Áè8`ÀØ”u	 à²QG‘ â¹,M»!Æ¡ŞCŒ˜Ü2-ë^¢RÅZ±ŞÜÊzî uÛCë§öêÓeÔá¾tpkE´ÀªÍ ‹fn×·}‘flÛªÁüÕ¨;gÆ
İl„©ôòãÑ›º¢¦„kóŞõ!t}ş¼†UÑ4±Ú™õÆg®÷ü4	ÒË“^(°ìÏÅ]gG—¾A±¿átc•¥®®€ô/§¸E­Œ³†å5òêÈi”ßk;ˆ6Ët™Ì6oOß;r”’±Eí<"Î’Ûi;sÛëº Å€†ê_8Ì¬È#‹Ô@ñ¯³~EØÂwxYR_õÚ?)´›*4Ûîş™–Àš5
óÆ@ğ€8+ü½6Z
qÓ¥šäVòñœDxï{HÉ= ƒÉ8IúSá9º•å¯ù}½9“z-ğsó» p2-eødWÈjoÍôÇUÊ@ÜY?«yÜµ8¸ê’<òtıÁÛ¹+$9¬¯-¿¯¼åĞSêjMÃ~úÚ/wXxkÔ´ì÷]ùTòˆ|¤œYKóŒ\X’ü×	âšlèEzŞdê¨¶²˜øª©^G ny¥éÒŸh7­gÙ‹arÛÈeõ/–à-åY QôŞ•¾q=õu	3Ä¤ÂÖÖ2`ÃÛ#Ì]¶×ØkÇ¬:ê/KºY/ŸAß°,ƒ™ßœYkT~F:Y\æÀqèlğ0¥½(N™Ş™~µ®è^©_F´nŠ’ÓŒ
©LAŒËñI!=ÀİÜr ÈbY¿²P°ñ?®ÊP]4_,F9¢-Êl¢¶ê9Y»WSÂ¾‡Óæã« Ú«©}û‹`ª‚Ì÷µDRúğ[ï›L¨UTãØ g’¼íœL>ë6ËsH\u‰z/Õ À,L.ÊkìtE@"AY^fºÇae·ä´=—M)¦(ã "é{o-Dgˆ	ÅîÏJÕ1ÙRò%:Í_…Âo&Ã]‰Éüff2óF‰Å>V_áWÌUr¸Zè±ìŞ³t¹èO nƒ|BxZkA[õÎmv>hYé a‹gî°vNÜ›76©üˆÌ°ÄbHÙb3¨#&²ZÃ.²Ù”It]
3ßÛéuœg÷s7Œ#‡±ª’Ö^~øc°«FvÊjŠÕY¨.N…édÖ6gE.]ş2Õã/?L&YÓÇŞÙ§†j(;ajd<Åë>GÅú±âm+MÀ$Ê@Uîã2¢—‘†h»¢w®Jñ¹(³ëîBöYİŞá/šEª
e†×¤õM”w ªåS² ¦T¨s7I–®Ÿì'Zû”dë¥À=8o”`Åj”Ş×j_ÚY(¬#<Ó@ô¥T–'ğı‰£{,'Ch35i¦:æ^=Ê?Ôk›}z@Â„ÚÂn®OŸcoÑğ[`ÁBSmÁı•WJÇå2p%ÑÅRL²ñp¯×™8'B7JïÙÈ;ï<3SÄî°œ 8™ŠJRÇŒá9ñë!EÊX±cÇÑsÏÌÿå6¡)#†Td,5Ô>ó~ ës"ax0­o¸
Á%”İÕ–‡ Î!Í¸|ü²„nbö&éG˜vç*˜Šv
–díO¹rVÕŞì`ö<Çj4ğD±Ÿ/‰_V‰£h„:ÆÓ›léöG]ËêO®Ó8˜pœ\‘f ˆëY”nÉÃÉü“¥… 3ØÅşNİkª¬àN‡‹¸ BÉoMvåó=T\ÌO1LDÌ"Ğåo¦Şa{«eà«¯ñ±d)o¶£n9S³IˆSLaİmíaJ.6
Ù›O¥#bá\ù¦(®h5ŒŞ9hiØşúïL_†ôÄe–Ç{Xá+ÔŠ©/ÙÍYêÍFóègÜvFÈßŒY_.P%Z—¿TÜ_~,‡bë}™ë³,cUmúÊİ69É…X¿½rôú?.z~äQ+‡pİN€§®¼åÎºùS>xŞs÷
¢î:vÈÎXëïaı${{+ÚæØ}DôÇæZì“_±*Ê±ø{78>â`(‹!Õ­R¢B0Ö]%<LîcÄIî²sÕûä§dRÂÍ+‰x{"Š)¬³…î·Cü\×³šò‰Ï€ß9ûŸ“RL`w"š¸‡—=mÅ6Zöƒ%Æèê “#ù<]u£hWA@ŒÓ¬ l#nD`}cÔ@ÎrD¬û‰‰”ê/Ïé§ÿiîŸÚÙĞä¢ş`€Ì	aTÊË‘2“r¿¾¢ûyñÔô5“{
ë{oF]ªŸA«şº8tÅ†éºô%6P);ú•BĞf‚B!Ù İÂÎjPtôuëfZ™ämB`]g¹CBËçzĞ1ÊÖNÔ©BªÇs?ñã&8Á“1ëMY“ò4¢¯nÏH|ş”t‹ë²X´=ªB±ŒMu~ú¤ñäe(5RÌˆ,›OBb‹Ô÷%°#¸Ãàb#=y÷î q`›V–OÂ[ş¦6ê9gØè$0\ƒ}š‚Yhñ,NÉ…¿Jşqcïæ9iæ‘€Ær˜!ş<ü8%6C«Ö‚xTØ>‚ôÄ½rd!—¶Q'èU¶>¶qûú¤şm°»‰HÈ‚ùî³uCÄ,íÆb˜l¤åü„DÓ ¹>“z*5]¥ÎoÁÉ˜›¬;qÂ¯|[	ö! Rv¼óñ8EƒK>Â_Ã¸‰‰ê"a´¯[DTS ®€‰ÚRÛ?š+á_ÈK¬"•¯Í¯Ú×CÚ–Z¹Şªÿ®Ary˜1^³;[î]c³0×|S¥5›My‰]ÒI7ğÙ¡iv:7·b(³…K»ğ'1/Eõk%×}}Õõ•_cAÀĞfà¦¬–ˆ:éÙ½n¹‚­ÚÒ€E4©ÅÄ«PçS<)ƒéórÆÛd§ïZO®˜hXš3ç:mºQ$k`Ú—ıüØ‘qXˆœÀšl8@ŠşØ.&Od™‘Ü³Ê®‚Ğï6Ğğb+ŠTg…W\ÜlÑşrVO±İµ‘8E›ıY¯`ĞsÙ&lRœ¥0tÜƒVÄú}e·6Èü›Œg3<*Ë)ö,ñc€˜s9$mø·¼ğİ÷ÎÎÍ,@•Â@WB)tòïÜ
9f(µ"É\×1ØªÁ~‰qH‘,H¿´{Ó…â[İEÔüÔz21Y›ö— e©Pqt#!Éš$ÖBdå©²tRÍòFÆNe…Rjqh¶3#^Ã)vŠˆiŞĞ@¼:.ìî¢RÇèÚª|–:-¢Æ?+ÓxT–Û7¡–5ú‚Ol‘‚~š«ÊØÆÑ:qtó”ç78æ9ü CI0İdÌ:ÇíV‰ç¾áêú¸øÔŞ1¯nõI¥*C$•Ô‚w.×¥ãu#}á!Ç|É¯·fà=ª+ìu•ÇV$òT£ÚÛ¢†]Œ…tR<îÚòW³ğxj3×H•ÍÑü2KK	öa9å,ÖöslÒS;ÊŞ`¡ éá_Rb°æd2âÌ³.ıÜ/Ü)cè*µÕ„Ô“9'æ…¢·f°•UÕ„	CøÚ™KÎí©¢7Ù ĞÏaM²cĞijƒUcq7/ßdjR»zMĞ 
}¸	uG½IÙçµe°Ïfr•G
©>:†í6lÛ©Dut¿dÖÊ¶WÁßÊİ0fÉG2Öí\kß:]ø”÷½|N€koÃóÚê‚±lÙµ3q‘Zñm0á\-‰Òª£ÊZ1“‚iS‰c¿¢| |‚+¹„t™:ô·]m]Ëµ_ÑFAõN¹­.¸÷­i‘âì²¿Ø41èv¯z?
}‘pIö¾oÎÍÆx	=ü°ş†V‚¼İ9Ùqæ²kíıÍ×DZJıÅ“Ùê9\Ê¨4&#Œ8':=Õİ×Yç¿´&õ}€×¦äËßRRÉhEèÖÎº‘•áMIè%šïø ALz9ñ’'èŸó}Âˆ“F!ZL)–:4ÅgŠY‘´Q"6üUVâ_:Z‘7ª<|u2ş0æ¢pn*Şn®BÏf·°‰{¢t…!†@…pÙ¡D¬Ö¸wsx~1”¥‰ÙswËÿCÿ6SIm’Z8Õ¹›¯«â{~³øôC[ÖüYè„¤§¹,6T7QO©Íby/æ@¤yËƒÙ@lÇéÈ¸£«‡Ô|‡8ÕüĞÍØ«ü÷ÿŠà°î‚f”4wMCx?²ıÙQmíi=hÜôüÜçaEtÁl»‹Š—ùlÄ“ãIÚ–n7‚EÙ`ÔPšl4²F—®İ…‚ÑÚØà®°š^œFCĞ²aí»¥›'œ¨KÉ¼–¼ËKŠŠĞZjŒvƒëØ%vÂsØ1Õcæù¤$H9Ë—²pª¢Kx›ÇŠ¼­H(¼‚§ÒåK3¢‰;ˆÁâ^~úR­*U¼ÿ/òõC-"×ÈÃ¢[‘ó™SÊ°ü²¨šÓ%YÁ–ø~PNd‡/d†™Ïçúà|vûq@í26j^{W@ÈóhùX?ú«4¯_tîg\©Ë5ÿƒÎ›ß¬ÒRr¡CiÍG¹@cË”ùÎGÀ‡8ñeË¦æ+T&Õ{û2=l/×ÜCÅ6ˆ÷°Hhcuö˜]Ó­eHeÀ–ëá	d=dıºšI²×µĞmaÇG¿8$Ü«8G$2Fµ[¹)õ™ĞRq›ß}ÁT†CÚ¾TLÄ8y„&¼†Êµ˜’°aÏø™ß•©tÁp¥o
/_è«’dÙi¥MÔá[šjuÙ†mE‚#í¬lÂ’†²LÄ_ŠĞe³ ôÀ –¯˜%w»x;C0ºÛP`~2ÔúÇî zóöàAŒwÈL@£ˆ•!Ü>J°ÜæW›o„~mDçÙIÄ¦o¤Ğ×Å·9rğ¬©‰Á€à»)Oö¸Â…•WHsRLÌGïó/=ğõĞ(ìûM9~ÂBÓv«0=­qŠ¥Øt»¢mÖÖÀŸÚÅÛáF4Á·z=	;º¡°nòW)hRün’é|…àÆhµ‘Ã¤È†]‰„|S@rxvî j~ebĞåí¹ø×»uŒÃSscã
ñX5.G}6x‚}™Ã«D¿‚uZÖ@$3Ïzr ²õşç
cø<T9l—ğåñ†?šæZÑı6Ì´—x°N+‹Â±ı/Ë³¬Gª_ìĞ!8›’
Á¸ì½Døw±Ê|~ÙVPC°ZZ‡äg—
 ÙiŒ^–D&øSÔ»2„]ëbÇ1GÑî+_ÙBS9„SÅnÏ·ò¾œ‹,º×@L Á/8F?èx«@É‰•)ÃÚ>ßÒ›Ï\ØŸÑÂeşĞËX˜µäfìZëF}2Ğá´L
'ü qİDO>RÛãÛº,ËÁGÿ@à0!MZj±¦mzÜ=aPiÈüÓçypÂZ:ª{ïø]Şz×À™l¯‡–>* İ^0JÅÜà™°aÉñX]ªƒ=Í~¶Ú~3_»Êeïo5âµíG×=|«¥¶=¡ªq:B»Fwm˜`hîô&'¶Ï
ÍZœlØ ’*è+ ¢˜™…Ü›:ıP1Ûx`zØ‹æ­„é’{­Ê‘—lt]H.Lm²ÏU9/•OóMöÊñâ“Åø5Cñ ¾hZˆã-?ÒÕòTõñu÷Ôaò€ö P{²ˆ±9•½«®`&‡¹G­šéI5`ëF¼â<hÿ¶» FGX¿ÑnhIºDxÌîep ¡©°.«ÕÖ=’J¶Sˆ{`ïe!ıFX[mÀ.¿O>GéÉõ'ô•F¬Öé“Œb·dw/·N
„£:"Çñ*P(h%ÀÏÙcêj’UËÂÌ(o‚…§,ÃGA6pÉˆÊ6L.Êd¿ùÉTtMÕ!er½’ úÃ£a‹…ÎP*èá	©¶ Ÿu[íö-3ìT%ü¶oùWÏDAZ÷WŒù|ufBÏ:â¦’!ó—jlŒ i6¿gGâ‹ŠüÓcãÚ5)6H­m°™Á¤³y·y¨D{üÆMÿè`)Æ&y{5‰¶òîQ-åiozÃ>eÿò+„­pNbÊU˜â;=Ëy¯‚9Ê,o¢¬k-fïJÑ”Z×˜VÎöb•ŒbÂÌî…›r¢£¿õã .÷Å±ê?øK+
“?¹ãå?ÀĞ
˜rç’¢ÔqC/üÓM¸×TQG*ØN¦ÜË½¶Œm5SÏÜLÑ:³BE›m\ 6&„n1Ur.ÓkÁ®â„DhBä™#­É†Fx`˜¥ò	Ji± ûÑÅ¾+÷x©‰U$!C8n—yİŠj)ïm1±ô‘xófuâuäÓ9åğ*Àÿ o!ù`u0ËÊ)óz(ŒjŞî	EÊŒÃg€•bĞ"3‘˜¿…WÑ„Üp\ŒŞù)NÔLàbOÖŸ|©XVGµNµ
æQÄÌÕÈ›o`¾"é-¡éD“ÑisgÉ»YøÅ¬Ò­¸ÛëÅ1çÕn­`ïˆíL5FÍ4Êi’L\lË„sPéªwáj¿£¦6W DÈ‹a¨ÙP¸¤ï|õeãôTòU~ÔØ°…-R/ìÊì{º¬5Oî¸MØ%±Á;ƒ3ã´;A1ÅP!°ÒE® ìJÇìêk5f;ir‚×ü	¿Sw&±iã¿ZEu `¤%q§´ÛV¸ŠR7†–]íß€áÛ&‡—·Şr}xÉ VQ?ù¸gÅ¡˜cŸQ…b	‚/&$|g/á8*8ÌæLıjôéƒÁÇRo„—p”÷"M\§¤à>È¡ˆÜ%'T±xù3´¶2-õ.iA
*äBÊúı”,öme%@
İD(–¨ĞöşDÅä’v”¯b@Pˆˆo'Û~Ã_;½.´$Æ2ğÏ•wÖÕ;“YÖqXº¨ ™q<ØÔîùÒ¤„ZN2ü.Øó.Ğ›9AcT«Ò%+ÿ¢…]ÖÒÊv¯
ÉWÇØøf+àÁj–]Çrò€#êò#c9i'%\Ô˜r'Ğµ™ÊËwojyáeq'Êm»=ˆk‹%Ğ—iÛÉ–ŞI4ç²Ä¤K ŸÕ´RÒ'”ñRÄ¤ºø²ùÿî¨T”İïJqº9è@ó«İöæñbÃìŠ3\4ÍZ$L#‚UÜtAØ4.Ï$`¬¬íĞ–ùIÂIÒCdytò%¯q,Ø,]	pjØ® k¿CÙT¦í~õ‹œ øˆd±­5B/K p~èna—õÊÀ¨gİH^éäˆÎb^+†J•Q û´˜Bfn0—Á ÔFm8F8]­³QD—‘e¦‰™u	§`ĞÕ2ë9tNsş=P¼ß)Hµ?àJ£ÿ÷äET3r™&-E€¼ ~ÑÙXúÑÁºµ!°ª¾_]Ÿ3¶£›!‚qåğôûÉ£0r”8£ãõ~·w#;Cìü©&bÓùmıªJO¹pãúDÁghEîĞ;ç|ä£@%]~/Qîß‹Z‰
×€[Ê+çô¿™o¬/sg+¾mt¬`§Ì<ÙRîŒ¸C‰Øÿç¡b¬e øÖ¸`¹ëÑW{f!	ÃÁYzè£n±òœÂòÓ#ù¿mŸö¬AB8ºåJCE¶Pv©âjŠŸ1«•øÆÅĞü÷Ş°¢,AÏEš[Ã<¨ûÑŠ£)Yc2ÎÄhÚ}‰Ã[ô„Ÿ¤ãš²ào‚/˜¯ÿ_–RQLÅÚh³RXX]”ü*6ª4ü9ªSf‹/Éè7ÈCM<ÙdºúRb¼2,è}±[Å|Z-º…aZ(ØHO¼¹ààè10·KÛ³x†çößZ¼€QIdD~˜w6n`tÀ£V¬Ğ&L¤|„j¦­¶}—Ñ0ş¿²T®’>ªÓüÜ›NbX›÷6¸í*õxûñR Ïßø‚ÜÂœcı€î¼G¼T-{k,ÑÌKZW	*iÆFXâ4µxä]{ãbìš’»Ã%Jïm5Ûêãó"µuúµUYİëÂÉÅ„şéb¼KŞ¤ï‡¬ ’Iãö^¾ôïkRpğBğMÙÈAÅ¤ÙRJ¸	fÃÓ¬mÿÚ*©®‡I;|u ‘¾Ì[!—:µ½¡.’{klò0¤Ö¹ruT'p²;.îªSğ,ğ…¿YTª˜Oy
FšCÚ³ÙJ–ş<ÿĞ¸„˜|öG¹G(J¬¸ğ˜¿ÇBµ(…¢*ğÇŸ ‹1IbÔ®¼üÁ¿-ä¶óÉ…]ê'gHlœ–ş}Ó#f04h2ê.eŸŞIkêxÕ8'ió·§ã8“ äv‘WZêñ¦¨²OLF¡ì2Ç®£âæP~6ş²¥#×ÎV$ı—SêI4rºmIbÅÈÑÏ½<‘ømõ›»S¥4L 2¢ñ9@oy®6ÿÇıî`U_8š#$¥ÖâgÉC¢_Ôöe®™½©¦¥+¢@­#MşÜR•Õë ´Úo!lÿ?lav“I*Dİ)ØˆK70a?9Z˜úù¦4RAY†{{tKË}ZêWho¶yª±–d`âé·š"2KÔ®¢©æªCJ*-XÿörtLñïô™ 6ğŒ6[¼”‘ct&P:\«ŒŸ>yª›)ƒ—¡¿I‰ïÚ} q¤ûŠikÓÓ)3Ò-æÏ
Lû”P™J8&Üïß e+¤G¦/­AtÒ7êxäe‘®O5‚”èÜ8TíN[Os}ÒQì7Âı&µ_ƒá©@\ºº2â)“6õh\İ×™]Å¥{›ê:€’Érñ‡g/XÓáI–¬şúÕ E ógÊûçè§¸wløn´‘\‡7óˆ"§ ¯x|1-æç˜K0 ¹?Ã Àkc`6®ù™¸'"å«3B6Îzı•kJÄó@FåKßÜ+Šş€GéEAæoçÇ?¿8jÏ÷)™%ë8Ê·âü·€}•¬x^Ê±®aãç¥¾íÀ_®±BW­GW?è.Pñ;‡ED	3Ø‚,×I[§¸ñCE&0…>]f'iˆ/!yn¥ÿEúŞŸîìë2d±[4ãÚRwƒ³!·Ö/^ƒú®êoò‰`_RÎß‘Wç›r›&T„zî»®ŞÊI¾Ëü”Òpiõ!êˆÔÛûå•cé#Îğ6b*nã6a«˜$‰×‡¤ÃC`°¡¼?Pü-Çf7Rd4å‹‚^¿ıŞ¹~Şûæ,Ê‰Š±ÔV«;f»qûô	9ÚM6˜ˆ‡Ô_¾q{D0­][Æã%ğÊS×˜LE  ]ôÿ÷-—ï_^Q4áNXŒqÙé}U{à{0óóAä©ÿ›Zù½ØZÄ=±í’	›Í`¼£–& ƒÔ[^ô¸5½‚Á_ê‡‡’®?Ã@pˆÅJ\Kò½ˆ©E£u,¤'TÒ¤]éAÒh©ºÓ®Ù“˜Äé
‡(½ºº!ìíEGlæÙŞ¢i_FóL”åê[b‡“÷€H¨qßâ±›xÇL“	ç‘ŠşhÉ—Ç›!¢£È&9TcBN“[œSº6hIïB³Ñ¨zœK3è uH22Ê®¯çÕóHØ2^£yÒğV‘äÖúûæA‘Üû¥Á0çü˜	°1Î~iš"B{¢Û†••^Yˆáˆ™,öºq8Á÷1òI¶Óuy<3WÚ›ÿ5İñ9D•[R¡äb4Ù¼>%³úĞr#¿ˆw>şì-â)j]t[am78Àİ9ãøl·xşÕ©‹ÄŞzÛÌ;éøçXY7uRBèaË¼]eà»zX»¼ë’Ú}r/ÂØ†ê:ŞŠÚ“ím}CŒ\øLeãŠMG$$?œÛ²0l8£2Ğ`2§H(ş€€¥Bq…õşÁ7†˜«æïª¾&!Z"d6êk¯ã¼ÿí¿8„ûV÷ÿ‡è·ObúhĞa!a¨p·¹…PƒX-òy­ÉSıY"$²&óİ]-ëm’êW·§D:ÜŞs”<²¨†Ş';­2Âé‘Ô¥}%Z=B–ìïZ¤*‹à¡>”Åš–Ô"¶¾”$ÆŒzÖâPúİ<%ô¯Ñ/¹FgeŞ¤ë¯®“s×=ÌhüçiÔ_eó[Ö \–¿iPåáì¡¾jh2äË‚£Â>¥ÑN;j7¬	¡Ã´¦ÌnzÄÌ“Pù*t,€#EÁF>´ı÷bMo@-Ü©yDÄŸ #çr·°KVë2«WĞ©~ô@fß†áşâä)RŒş0ÈéôµU’WúvÂ–İUØÃSÍ©
îf;q¢…ñ›|…!ŸÄE6ŒŒ»Å˜	™°2RÔ9TM¾Äƒ+»p#?Ú{€s¿şQ8‡gÊ®’vy(…7\ÔÿjIÚB/.^+ –àšT°m°‰f”çïÚ\Šïzq¬§íPã‡ß|Ô€TßŸãz¦7#C ÒH½‚P§±×õ‡ ÷Ï¢*>¨½â$ŸJº êºŠí	ÿdë­–¦ãåJ\äO
ğË‹¢ÂaG¦è0¹;[Q’/ÃR¾DÛÆqõ ¿çn§v{Ï¹³ÎÑ»…|õƒfòâ’0^°‚óË*ü°òÅ‘c~ùÌ¨|õŸßbóúõåtğ—PïQ-tîD)yEu˜•×We¦âñeÇˆvË¡€Ğg“Á¨÷ãì7İ¼“A~¾!uúo¿È™ø5-!~£ T½oæ1œûBfSüÁÖ4™ö£Z&ïŒıâF»RQD½ø\{gÑèfÛ$·$VdRİxÿƒşCHì–Fµ1áyÆ«`,¢Ëoì¡7„»¢ÚtÇ¢6µ˜Ë“å->ó™DºêÍ„j'Ñµ²f"üŒª)Ìxmz\•û@lîoq
­…9™¬TQ .¿[cC*P!ƒoË'û€×ìZŞGğ"¡	oç´$vWŒjìê.ñû¾V»¡êez€)>	5tı}]£qÓ#ã+„Ğ|K÷Ø/ê²©›}
$kâã¸ğ¸VÅ•±§©Ie¶Dï;’õ×ÎË™7äo»m\h™ÕfdÙ.4N¸¶ƒôo0À{0(³›¥lR‹aB"xV!ƒÉŒÉ]QÆy¦íš¦¯ÌH"¬«•íÈÄ’e£±yâ85Je‘›è‚İ‰i†MÛ‡ÖJ/>ÿgëÌÓ ji {ôô}Õ ì‰û°DU‰üŞKèê¬JÊ©ãÙœ­ÿ€xd‘ˆe<vKœ©eâ„8ó| ‡ôÍñù•öjÃöœ +vrÁĞæÍÕˆCä”¸XÊÎv‚Sü;²¿Uh÷“Øá©¥D7Y¼»œ‰Rfé6SZš8™¥€¥Ã¹ÍÀ³ç3ïli<2ê³µŠ9!8§Ò÷ù…–Óqe¶LW‘«Vg¿È·ç÷v‹ñ*»¢²§ówbÛàVˆ-é¥O)ôdIoë²+$ÏÑª0 $Œ¤àşC‘ô`ı/3^W}¨(×¬¯À0¯H
pFÏk+@›½â’ùw÷’­ÙÓšMsâGE´f’ğ7šÙv‹E×ÎùS“9¨üÃ
ÀW…4Ë™ñ:/+@€Vèã“{Ì=VOEeĞ9‚ã€§,¯(?gÙ´ÜqŠü]	õ’Î7¥‰°€:Aí¢eÏ?[‘F/[mõÿFw5Ça}štXÓ©É`b¹ïDş1§arĞ6ñÏ–Oÿ^&ÌAPãjlˆspèêcí7xóU|ÄPûc)ãR‘ğ3ğÍ÷Ü}(ãÿ$ò6²i}P»Å*<àæÀØaÕW³ğW$í‡G»åÁ™bœC0•o°{óµÑ†‡bÿG‡®Ùü)Z3öÒ+£†½4Vox¼„ËÀòy¶@Ä»|`45ê‘sO£ğ;r-´[ı H‰Hû×õ‘\h±+ò	²Xã’Cª˜ÇÊy†¦èÍËüí‡ƒ²=íN—?N|§^»K‚ıg–#)´Í4lœ"!M˜mTJFÓS¿˜3+Ÿ—!ß2ÑzR™¡*7¾ËdˆzÍö‚õN“Xt©‚‚Ó›ónœ·P±XŸ4Ø§gu‡8=,úèİİàH	Fá%*P/í`{™
t[Vä°Pö†´<ƒg³´ü>½ì‘·5+#uò£ zÂ[å`{dÒ¯6æÁG£UŞÄqğ¿ˆëP\ 8¸üAtGĞ¡r¿.íóLu‚8R{.§p¤ş‡d_[ÈÉµfì§ÊsVö‚šüë™*Î_‰h½X%ùwÉùwTÂ	
óœ…ÔÌªQK<Å÷Ê]½7Âšpùéiv#. sÓ°sóJ}–-…]NùÙJoS	MBÿ»RÿÏ³È‰iÍ}²jÜ†^‚ä»1&^¢âCí®mf´ú¹ˆµ{=òªZ$«°;[I§£ÊríPòGİî>õš<é6ë;d„Ô;ïG…G¹iB²©Ä^.o™ÙD•¢"@…H%]PJAµV'Ú5zÒ_ÿA„|ÅÂÍ=b¡'i%+4\Ãí°ŸıDêdî&úº€kécü–ìfjÛ!Ö°Š†Uº¶ëK.,Å±æÊF~}bî5–ƒP²fŠGucşxø[Œ¢“ÿ¥•4ƒäMÌ¸Ø²Ø!>a¹òÓ~FûÄëA…Àc`Ç>…Só½7Şá^B ¦?9UqhåÇı5}koómÿ
Ñ§‘˜W¶Áı“]ë:0u¶«{¥7NÎÚ¯$·õãÅ9.¼í—}Ä·¡ÜL4Æë¹x¹»äŞ¯# 99â!Å"È’úİ-2wM7ê³p0ŞPsÂül°sKgFòk„]’f\Hú´m |İdÕ¹+ñ=Îü¦ëÎ$ÏëšÌñ:ÙëóVr\Ç?#•Ç™ŸaÛÉ7¢5‡O\×¥P²{kòÇ‚!™i PO.;
Rt×"·7’ªROåßfpã9Z§-¨èîÁËtß‹‘iw¦ )è§r6—¾`‘^óê%X¸xBI±à¯Í6……f„´’WMŠ¹›`èXÒ¥İç:ƒøÍOÅ…xşT¶:ÃEóè™YĞflQĞ•ò„“Eq§à#ÌvgÀy‰©kè1´^*q¶ÇíMÓòB‹e›ŠE4yêË ùÓÂ^Lõñ¬<>>s‹¢wØ3Íf²)ª‰­gË"lJ ®êp¦Ä†ÃˆH>ÒXT-Œ’aÌÒƒÏr"Éİt°B>Öª‰5Ü¥ãÙ+=AH7
æl+(Aâ@ù“7TõîeÎ$C›Ê£8†‘°Yqı]Î8hèôÂwÍ ©ãıåIJù³u8j	Ó~Å¾fêÇ›:†MÄ¤1Ë¥Á“İ¶!•Q®*bè=ò;Ì&‹„Z¬g£&§9…A&ËÉ	6—åÍj$ËZÏÃ–A·7ƒR‰Oí‡ª¢øîcŠW§"³^åÒUÔ¯½r¤œ\Çj=qJ®íwcRĞ!!N.BÖŠBÕ+.ô
¹öİ(³AÕ¶³9KmÂ±qæ\rHu07\á¸àGõ‚Ó´«@ú¤´´¡oµ	UØähØ£ãh‘ÒÛ“zŸeïr¬™¯É
ô&;;3+ü0ÍwKC^>dÏä?W±µ,WlFşÅ«E±oŸmßyˆji$‚¢Áæ7…0AY¶&Ç,:¬ˆŸ:¦Ø€*0²ç„mkYÁÀKÜïúCrÖX?*”²q·(©bı—İ„ÙXa9ğİRßd¼á˜uËQ`lñUòÄ‹€—
*\°ÈüÑ„=*¥?Al±8iÌm2“±Û¡¡ÍËTC]s·‘Tx'bHˆşo gÒLÉx¦âõ6¬bI‘Ü—FFà&éƒh±ü"…»h¦äÇÈzLdG^2šo’èLASºi‰ÒsÕrÚè²É?óDÊÎ½™¥GïV#9™Å™º
?xS´Öˆméa¿éÙıŠK›š½ìİ0ˆèÊìÓ-U=-ëDkNF(Æ”i`dr“åÍ êõ½Ã<‡Œr·®TxÑ6u“é_H¼V“vô`¦<j^°ôiQşX@KĞÔè¨”Ò é+;HÌÈ;ƒ…	€:™HÖy½Ô¹<^{Ç±“Ûÿı×”A€ô»áĞŞÖ#Fœ‘ê‰Šî¬Có}Ÿ‹ÛhƒÉ¢óÃÕ:ºçt#‚ëß	R@^¹7VF§‡Ó÷À¬ë+Š{> õÉZtêOávŞ©4npµÅ¤7å: óâdˆ>ç±´Äæİ±ëÿ¼­Au¿À“sêğA½Ùé]~Üj‰Ä
N6¡•o‹,+;À‚¯C;Ï¦Ø\è4B2ÿº=mn>.h=a·ıûºˆ“AÙ^ËÊ«·.6â"$¢K÷§"Œ¼ëML¨1R³Ş
f>EÏË‹¹™D¤˜ó™ ln>æR!×[±µgGTÇ‹HR›œ	™œÚ—¼–bI(õ‰ äfM‹!·åyÃ‰ÕBpñv.(šºÁ±—1$ï`E“ÛãmA}Ô$„ÉPÂ°ä_ß_»}]º)¼¸2iûÉ%ÃìáÒÎ%'İ§X7 ğxE=º¦AV÷‚Ÿñj{ê>‰IôÚ*-zS¶onÊ;€?‚ñm¾Q ìĞBm>T™“˜¦:<ùìz!W«6ŠD2ô±•ĞqûÈP¢-}¿F(/×·”Ù<ûQ÷MÖ,råË
,kÛCIŠÍÄIÎÍKGõLm Û J“ó"\åmûĞ­¯îŸŸV]usv©n$X8QóÀ•>z“]~ÔG½'®Úf¢´‰íÊğ³È1¾ìù·İ©÷BÍÖÑGŸMÇ*Ë¤ö„§>_ ğh ¿R40?°œí»Õkrú"æÃü˜a[~ÁˆÚ0;)Ó-2ùß+u~nö-«¬ÕqÜ½ÔØ œu×›å×ŒVz¡«^f„” ûÙæœ¹Àî$=>Ñ±2ÕûÅŠ
üôàŒò;Çà‡^\Ã)'®å¨¼§ŸdtË)—Eœ(ÎOLÁQ„¦Ï95M$bøá>y`ixª}`Ç]¿ßÂAT$`g¥e¹şÈ®IZuOÿÿqßBĞÂc•qylŒt»$ƒm%¥åjş®³`Ù=À¸B¬`¢ç;[4 ® kbñK¬Ó WJøBñfPšîA~ùXºàë¬A-•ìWÃR¼œÌHKÇwõmC~àcHÙ]—ˆ©IõÂ"R“YÄ8¤OÊÁŒpOXr•C{,vÈf§[€™ˆ¼JMáhüÌSd¬;Â7¦ÆŞ¨* iª—+ÃÉõ™“çÏÛéBê5:æ9byMÊ£Ê)aäÜ<yª§¾(»4åÓÜq}nÔ6ÊTãÎ,£ó?(Õ}š†´qnÌ¿¾`©e['A¹éÇu£É™hLÀ¬YÑÏV(™üÁÌ/ùKS4ş„üJ<ëD¶Fã›@·éØ§¾ÿW(‰ÕrUªßÌ4:H{Ìƒˆ¶Ö–šsˆéq8˜Ó§qqæ^MCkÑêê¸š92‰µ(Wre¶Èø+4*İÚÿË~p`{T«gp"+ôS]€YäH,}È‘€óµõÍJß×–XKå	`z„¢±KKìÖ ÒK· ¸ïê‡¶‚å³(ÿFã -J¢	¿b8,g6Qş%%w;®ëa7†ù?‡¥@‰êòS<¦K’FaYã¿CÕ5 ŞbKŒ_<»¦…P“˜(î2êÕ73eQ üĞXÿİ„Wê2KÒ‹Üü,—üØ­o†×şaÃ-wüûŸƒÁÍw$.n‘â	*Bùóé 5¬ÕÊ
×QˆÒ•:M^•ÿŒÛŸl/äÍ ânú?Wjlbk©pyİŞN#šuÈd«l öÒç;iƒÏ)³i„ MUA¬µåÿ
ª0³ÆøjáAinÑm~øÂ*€Œ+r0ÎGYögd˜,1äÂRıñû`”şğí˜óp_[=·müÓjé¿3ó]T†Ë0½Î¡€x•¨Ìr¹Àås÷ÿµrw{ò^ã0WØš.gb!1râÁ&ÍçÚçE(Ñ8´¨ôÓ
€Ø9•9ü·}FbE×ÕÇŞúB™Ã’ÜäÖ˜-¸êéå[Ç¯Qœ†)õäÿ¥îõÀÓ{~SÃÄÿ’Ìè»í¬k¨Œg£ôòÎJ5Â¥hŸ‘‘f¾û‰4|iO&fë€NÁ´A5"òRÅ­iŞ¡jbZ»•”B×¢ªe(Õõ÷Æ…Ñòó²=1€qwr|Šù™ïñ™½0 õ˜`¬r^SW­v×qó}¹q•>Íf
cî…{O%ù£	nÇ4£2—8qUe >”0"Üœx–™78@PáK­Ğ7
İ«º,Å¡¾öÏêâeÛAí§C×¸·CÔY‚†êÕÒ–5jÌ$ß2NŒŠúvî"Šæ/S¬}iKğ¹P(1!Ó®–e–æğ‘Çqe|ËÏ4$G$RHdFv1ĞDÏ?xÙ–Ap)y¦Sî¸zŒ’9Ö.“Õ( È¸®enhSiÖI‹Ô›í’ÇhƒwsÄ‘(E¤w­*›rÚ]©FZ_C±ÖW˜¢ZU?‚ÛGq›7b4›¶&Ñ$ ø?d»ÙíÛº#6,ĞÄHGË…:µ®óå£$eeÈ«1ôÍ¤eáÌTÛ/!¾Â‘!Ë$5ËqÉV@$­'Ö@;y!¢<”_§Õ€Î>³™0(ª€ŒSX’\#Fë|àÈR>	™%¸ü­\çb§Wé6ÿEU¿¶,€ÓBXÚË(ŸÏ~ğ öC/a6q;µŒıd¶â©S¢Ä ·—¶"ÙâY¢Ì˜Ü‘¿«~¬PÇ4ğ¦Ü]H±ëÈ`X›Íğ¼é‚ôR]QWóùHï Oÿq|T®íI‘FTè¼Y	nİîK­?SºhİİÛ¥—CÓñÌ“ì'M‡¿bÒü€6·. #VdÇ.‰¤•i„ß¯SËöR¯ÿòR!\Bî@XçËP3uéµUdß…âM…³‹±œÛQæ?rhv7UôEÉ\-z\Õlò­):3èŸØO ØƒÌ~r™Lo®©Jºpj‚À	¥<¿¨÷réğA6Ï¢ì°¨KiIƒ“t²æ-ˆø,b^»ƒ1ÜxñÇ€øEˆê¬ê—&²@FÌøgRÌR¡m[ÂYìÀœukñ+Ì¦T|¢ı$f*·ˆb¨ä‘=íÈUoğè,ªÁ$hëÊ¦Ã>9uçßãªªÈ*æ´æ/G}ÅÀ•N T±ıtr7¾èãScK%„C®m~bèÉşdçPƒ—¾]\r¨>Wf— STáã4ö–s è;ÎúwæuÁéNŸe”ñÿÖiéNŠû(Ä'­%š¸='µŸ°á'±1ú¥
—•zzv€ëDrÜ:uIAÍ":,¸ÇÑ‘[n;íğc?ÜsvyÔèbà‚|Ñ›]omü<’–EçèÉˆ‚µv_İx}2îI{<[.X_`ÿÖK\h½0*XqWÕSÓÆÒ$ß£ô åŠU¬û.á™NíØqPõœYî¹"øMÙù$ëØ¬æŞ,^z£dO@ğn'Æg£0ê}9—nh×!ƒ6êQ¯¬íçj#h<ÖV'—m†Ÿ!İ))ùnÍ·3ïİ|u±ğ,ËG«„ÎÒWd2„èŠ`•w>Q/=•0ÿÁ£Ş	J·ñÉúTöõA×l^…c¶h¤¡*nËÊLÄÙÖ³’d¿ïpÀõç4­z´÷Ë.oÿbKEVI¤mfN<Ò·CÍ6Èc/(	‘4|¿Œ¡›vÿ€şóü[³‡›İB3ÈZĞûú1_$˜ªã
yVŒ€]yÜ²ËL$8ù5*„ç¨>Â]ÕEª“„åfõ5d˜Ebá\é}^¹|Ô¹ªwì0ÎÆÅiÑ{6Å¡
Æ–u¬ØJtÅ8š‚fñÚÊB*ánâÁÌ¾öi}ÔãÛ#ÜisŠØòæáàXÿ6R(lOS¹«mŒ†|]ŞÆÏ´8ÜÑ`öj—òP¸ê\Ò3ÔKZ¡Ù‹®S“şëâÒÂº$óç…-é=Yİ‰˜ø{S•±NAÑ{h…8‡µXñéİìbGÒbø óÓ"ìõÔã‚W3
QĞfÅ"õˆ5ÛZTa®>Ã¼ºQ°‚ŠsÓ[œìÒ
‘³Â1qßAu®å–Äl|Ô„|š\4O{+Ù·¡B¡dK‚®‚ŸGF‘#I'#€^KŞ1g£0S?ØB<1xñÏ‹>¿™öÜª|>ëAƒÅ·Qeÿ7¶[CI hBÁŞ€87x‰ÒñıBİk.ø9+$É|SéàR¥¬£m\TiqI=‹Áùÿ·Eï*Fñ–Î&YQ¹ ÚFş:g-PCöPÉ…jÁ³×eX2P/ïÁ!M¤|ÈwPèÏ©‰<¡+ ©úÎºÜ±†ÿ#!-Ó‘™İØ¦=
ZÇøº²«Ö£\§ÕãCŠÎ¤ãî
9ìHÔ»³.ô()$9›¬ÅD¸dß(8ó|”hp”wí;¦lá‚!{<÷Ä0—ë,ô¤µ$&ç,QV­ÏÒ¾Õ°´%ÌÆš¼ÖIsù)fê›1z…¿İ*×¸İ!àóè‚t_ZØ‹tÙ'ßQœÊ\YæBPÿGÍÊØù$ô³tT7Ê .©qC.Ÿ=ÿÌ˜­@¢ëòÿÃ´ÑšzéïÏ„H:qÍÅão™¤G¨ÆŒXÔ•$ı,-é¨Y:u~9³OqÁøÄË^zÒ×ÿè·¼ƒp.@7hÂRa-–U÷Óâğ/º~·UEtüA-òi@øCÏ< xÎK»€ÔM¾Ïeõ‰#Çå.lŞäÕà'É£§8n~ge½hgç˜JYw,¢ğˆ†?²Ø,éğÁÚÉDNv6Í‰Ù÷c'ã1‡)Mu	j‘9ƒ9¼ŠW”`¶ğw‘8gšÎK¨bJã,O˜¯‚Ë"dÅ‰·¦MHfw'Ì#H6¶ºfZä
éÀÇYP™àÎ`ÏŞ‚Şòš:ş¡>ÕBÀz©@x"ÈYŒâ’øÖŞ£ÈO³¶ßÚ5(ü$ê³Xë™Í©ëTµ´t~3^Ë^æÓÇ¤¬k¯.IÎß1°b8M„Èì¸I9ºğ}a	Sœ¢Ä|;¢º”]ßğu¬°gŒäC»B[BÂs§XÊãÿØ•P ¦¥Ô }p¯‘ÌÈ¯ è å€ÏÌ¤×ş/Xo6ãÚ™+ôo×¸>|}#ıí$şcv¥{Ê”+¹’J*¼£e_²0øÌ»ÕàÊ‡QÍİ¡GWõ6\›	i„THÆ‚Uÿ»–'OÅ‹–_í”à1¡†SzƒÖáhóŞ¢^XA(AgÀyäØÔ]IHütpØ¸ŸwçàÔ©èÆ¤ùöß–4¨ÒLít‚OIjcÓĞ.±JËøÊ}t„Tò&Ë7´`†²KÆŠº=ª?P
è{İMÄÀĞ1ú±} Ïs?W¡{XoŸo³TÌ5hW!ê™1Óu<H¨İé¯N‹ßxÈ™‹íŸ†õÅ°á,'ºª·ém»×P½’WšşCFó™|!hÉúç8ìïÊ?!I:’æ Ô/] Üª&R¼½ğ+×ıìñæc:ÔiB¡>§_ BÎ=Ã®S­ö×zùK(KGÖF§’--Æß¯İé¥Ã*’¥6Ï´«ù)‘t¶²]bÙH_ğ?b˜j;!ƒÚ[o3*ü+ñ"¥£BØëKÚÚ%òÄçË}€åx“¢b®}İ8±¢;e:˜îèÌ1Ñ¨ZÃjÿƒÔ»‹ï-Ó&1tÉœQo¢ÔÕ"k~úyÎÑ,Áåèp²òª)sHØ™ù÷îˆÜR‹€xJ´‹¼ÄÓ&p§q|yNÜ~¢³ŞpĞ¼¥UXş+‰6gyš¦Ã9àÌ€Óº·§”­˜ša@VÑÅ]dÍJhƒ NúJ´÷›)`$¨á‚xhÔàŞk`ÎííîÊ+Ø(’s2&¢u#ÏOÇ{ •lš,³vHOJD¬øc–5ï®™íÒÙH/`~z Ô]ÍÖ™üGû[1í-úí÷øã^êÚ&[Ä<ök¾Xk_­¨‰«Éåp\ªû3’Göı©ä%rBıB<£Vë<¨›š’‘f=‹c“#BCE1£"
óçq}ÒÏ÷UHÊv8â÷6˜ä–tÔB¤ŠŞ{â“ş9èÉÙßÿlÁ¨úâğÆìË;»Ç|7&çËƒïIÊ`àœåyœ B	øƒÉî}ÛfQX6¾ñí°!%VKÉ€úì[[Á­å¯„P¤>²â”Â§nª3 ÙYœ^õûß,°–p°éÅÿ2€¡2à¢pÊÜ}–¾Óòªg;ğCwì¯ƒxnÆƒa_¹†.„¹ãƒ„S½cÙ¦÷nE¶ßç=‹ˆ©	¿ƒïÉ¬[Fõ(-	'„àÑEPûø	Yİ	•zğ ~~Âş‹±X	íåó©‡¯¹NH˜=HŸå½’”¯’gNQ}è;f—‰jÙšVex€ó,îçvC›&ô·"åîkFxÇÊ'ÁéË;ñø~lpË„E–K+Èƒ†ŠÅwğÜª8QÌ
«Er½ğÑÚÈ<yŒÂ‹cb84Äøo`]Ÿ%'›€ ²kJTäø{ŒşeôAÂáRuk†3ĞŞV€Ñ‰×ÍíàIĞsÕğÉíÁ]ƒ?3µF=Æî“YcÂóU¿Nş9×?¬Çšp±’OY6nVUÖŞ®g¾Y£…‰,õqƒwU<©dNW(ÚoM&q«8¶¢şvåHëçdFvë2£Y#ù¤"-3:8rÆ†Áb<™#…•èêyèÅ6×ît,\XCïÚ„ÖÏæ•šOï÷¢ß@&&ÛFŸ>5ß·Ï&ŒoËÀëaDMÂê¡·ØÖÕ_šö°Èººnö™¯ªqœëªt¹PHLj¤çée‘Á/òA@1UÆ©š-xF‹(µJŞuEë—À¤ı¿ğ¼¨Í“çù‚ØmCy~[ª/	"M=GQİ[pá`e©ÊÍIëáÎ‰È<¦ô:)“ÅúP•å[@‹¹k÷Ó»½0´«'w¡ş•!,âØ\(²«nWšjÔùzÉ=ø¶_3ŒºÚî–tE3¯@ûÁ’×¢ê4ÂáX@Áâà,nÈ¦F±k.ÖBÏ3<b¶ç$Odqx‡T»şŠQĞIŒLTÅ×wT‹¥gIMòs]õôM.VB” ,¾yÛ©hØ¾à¦ä"%İO9ñvÖæ…½	lØT@ñLÔej-7N–MJ°_Aæ	ŒÇ©Szî± LX:ÁÑ\ÆĞnÓ@p¢{Ñïœ.AôæUH ^ˆ´í:ÁÊmŠÉ¼!lıgb3¢Ã\«…jiü Ó}Õ@›`nS!™ğªZ:½È‡‚ëÕµN÷gCc|ÆŠA™ÂºtíJˆøÿ	–²¦yäbm@µşòÌ¢æªÃZÆ({9WWŠu†1ÁøÈ¡w´»«W¢3!ÊLê*­?”5“¾Ô'	ªØa+¨u‡ïıYğ8²zÍA›=š¢$„n_çwa|‡6 ‚ Sú`·¼@_™`ùhê,|'öjª£\ßio¸¶"à=JßM³i~¾S©âîK·ì&ĞÉé?~ºÍWÜŞ`È ‚s‚èöäâÖ¸/şî¸@ô†¦ÓÏÕÍÀšõMfCØºÓ¿şEtˆ$èö-}1Ñ¬\ğdUˆK_@p÷Óeöìí~ƒ~ÔĞJà=P6è°¾6[ĞÍÂ>ÍÙf½’/é¡†á’StÚØÂ©¾¢¡£]ŞÛŸ )ú²BôjYè¤Öşû!p?fFuÁ&%ó·
7EcúwhƒÚs¢ğ›[Èa<Ö…eÊÖì’â-<s€/@0»jnv†bùöæ‘¾Ä±Ğ¦R²^i]$w±ãl°œ|Ï’bDÊº³6E7X²hŒºÓ¾• ì-}ÇÜ·Óx+¬rê'.GŒ(ÛHj]°›É¹¯Ê†0ó²şKdÂ¡€™]ÜŸ“«QPß|]kH™M…&ÂÖs^Èó<dq!+·N2Yï¬áÆ`şD®cnÍğTïæó/n•ƒŸ4ïë¦ìk“Röx-ÃMã[…x£eõo$ÙÙrî#g°.8>gâ»k“ÈƒƒÏ‹Ï¬Iï'ß®Ã1ı®8_RL¨líÀ%¡+¡À²ëœ²û‚£w) oqdºà^ì&õ#†©›aŸëÏ?<"³ªÛªò®€YzÛd÷¹QMnÍ=s„æíÅ[üëx¡Òƒ¸‘ñ{ÆA©Õìl¶ár»ÎG8Œ¶ÅÅ)Œíµ¯?O½c®Â$ÌE±BÚk(+$ùç‡ó{×gœÀ -í
öº%¹ß›qY7Oqáj5gÒ£ƒh­]²˜:‡›Q.Ô¤øo_F¨ÆIÑg‹
HÇUI"–†LÁ¯ ~†)dß½¶N‡®kK…	‘sM÷`’lğœÙeŸÕø^ÌYÃQ„gÌw…Y†é…ìœI@1T"ÛDà1Ğ.ãšG—Ü—ÃSHïöhN/	1š•è(ç¯LÜ?ÇÛFÊ¯™3‚ŞŞø^†[m;;õ›DE*x0ûê’ÇŸCuòÒó,e€œËx¶]µX›'ı6¶pR›3k	ëAÆ>˜5†çwü?—ö|Û@"¢»' “Ó@`m»à»ıå!ô\Á~cÇ¬~Ñt]ªS%«[pğgw™K 8ï£	7µ¸”¥;{§Ùb,1Ûšlç ãtÜãØ(›‚r}÷3Í€0?nÑ+eŒ`)ûŞœ9µBÿ$*<¿4¿éeŠM„×Šæ&Øàs>;)·NĞkqPéÂÊrVH‰Ç7ŒZä[û,J¸¥b ¶Äá9<¿!h·]n§8×—–	"½ªãº„ªåV,IR@·oçf¼ˆ&ÂU^´UÙ_r4#Ô]Š†·!ù,D*ñ¬º–×”‡:¼?s`?MøKŞõè¯süõ™’\QÔí‡ñïj¹ÂğŞßş‡'â¦-!lÇlÅßÏZÇ³œÁ‚õå›û8ğ•™G‚iœÂª¾ˆ·hqôÇè7.t5= İÒ_+r™\TG›½…èÑ§D¾·è<'™jKî=¥LÃî²!4jŞı¹2Iv8Ò€$3ÒŞØÂ?›_¯œS(â[Ïş|G
ø¡±çLÙ¾smeué¶Ì"ù¤†ë:S##coÅH¤®ù¥|ã<MÌÚÚÙRhWıƒr#RLÒ‡mÇZ×Ş~˜À%Ù¿¿y‡Ö‚aƒxkRãa¤1[¿ğx”•‹í:kuØ†NÉø¦îD:Â¶%fË'Ôêdc7R-¸üz0
‹Í™ë;6âø]‚‚#!äT[–pP:/o“ó(ı·ãÍşùÊ9ş“}/˜¿Ş\ohQÇµ–ã4¬:Åiíe—–rtß'sa´Óí*7"K~v>{ r¥š›Œ>%JúÜŸR“lÉuo}>zÅM»îMˆĞßæ¦:ä.Ilyöçıw˜- ~	4S{¼+·Š‡tĞÃĞYç èÊÅT_H5aÊöªÆ_Ÿb•ÊVR—cßËwªóíNCbOn^Aõ“Ô¸½,­måÔõæPÑnãhéÇv³'†Ô$Ù]ØÌÕã¡Ïë¤Ã=¦xÄù.!Ê¾ÿ<ù¥„ES*ı³Ò’[½zİ$nù2iãğSŸö„h1¹ûÊ“-ÉÎO!ñH²´³²ğ$Š«R’,+%•"xƒni—ô¨Hëå ¬8¯@º¸VÙ¼Ì~j—; qøuö#€5½`Ò‰²ÆÚi²òLŸ{§_rÆÓaÁH§èV³èÔFNÒm/ã¦/ùDõÉ9ÙŒ³€œœ!öÑ<ËòP\~~\S—Nı¨ö…	µŸ·ôŞúÔÆ¡.W	Ÿ¯]åXÊó[r-!+¦W‚HPR]Å÷Ç;k€[ûµ©£Æ$	95CEüìdÖK®¹Á2 µ¾U|4/5§ê˜ğÇŸ¤“)©)¯Î¯j]ÂÆ¨—u[”‡Ú:
¥­ëÿ=¿BF‰(@ƒyÇiâR€"ØV/Ÿä1M09¹}™ÕG"|îÇ‘]¶1%‡Ï±Ÿ×JXÓ)¥Ø.e¯&à7’æXQ	WuØ&<{DÈEr±‰‹Épši¼j?PËw~Şİõ»dJåGÜ¹¶óoËæt…D4Ç&“.1Nå’(ïH(hóÀæbwš¶KGsmM–}ÿEc4ö´ÀnQ’cã*°‰ş‚ İÒüW¾’ÙSí|“úo†‚§£8ñWøsW$ºC¡÷ë?«àÑ<N*å8óòK’P]—¥v[šl46¥ˆP"X!“§F„‚3ïÚCYÅ/OüYè|VR"h~Î½¼¸jFQø	^ë9‘1ğ¸M\•ĞŠÊv¢õOëVä\šeÕ™/İŒ¾P!İ¯’:X¾å6Äì°RêËRïŠAª1p“ ÙO-Ìû4ci¸­3x@I‰ï×1Uîò\ı
sÑü‹ªìL }ø<75‹Ç’Q
oHàı§>ä‰¤J‘¬ Ù­’î(j$+T‰aóÀƒ)ÜZ¯³:»§®Éø½)ÎÆHö‘åä³KÅª5¦†G™";7ï:ÑÕ_)ˆE5|>˜Óµrı.¯ÈËØ Ö©î½°OéOäA78ç^£Œ†$°[’ûVã†Œˆ@}\¹À‹üNŸ©&¬h*¶êÇ~…è9X¾Hiá:o:²i¥sV°¾Û¢!®ÌŞW¹m7NÔï5
e“Ÿ²TÅ‘â °¶!¤ïá¦ˆ‹q†+t¢ö0o Âˆë—†ik%gT®‡.ğ¿.¨=±,:şÓ³°çêÿÊQ¿-äá4ÌˆF7ÑuZÙ æŒXœ±mo8"êMmcïÆëcàÃŒâ—JW¶Tñİ??blVrĞˆ±n¦Zµ
©¶5Ù˜?)d9GwN€ÍéÜÍÄ\I‡5*r¶ÓÒÕv½xÿ²Tö9€\úNßÆ¦ü2°?rïKsÏoŸ¶D¨š‹´ÛÓ¬­œ%ÀÅ«<8õÄ²€eP›òË?í¤6ËÏÏÑÎu¤)ØÂ‘âû›vûvÀq£e!aL`+ WlÉ[t€‹({7háéÂ¨x,@ÉnÉoM¥è™+%Rœ¬ø%TTÑÈKì•¯¸T½BRÓ*ŠM<D£8¤hgxØCfè¨uA¶CTÔÏú¦ ? ğ×
qE=eÕÍ34"µáäpëô‹¥C¿v#l÷4fo¾ÇÁ+œ#¼ˆ‰y­v½âoìk9ô&ˆ¨ø!òEèİùô¼³÷a&MíRíÊïÍ¦¨0Şrõ<d³UzÈš‚’²©İù½'V©ô–;p"Q[¡|UmpW—æp|&§ŞËµÌwy?Î~:ÄÌ_sË¢ˆ]ŒTIÚÃAobÎìq‘ãUÑz¬ğõÎü¶ôn¢i™ëìöNï‰=o“(¸>	<Ù’a_÷€ª¹Í´£SÂ± X¬‚GS3p	üGPS<á™=ğp×ÁÖEb¢æÖÜ/F"’ë0‹æ’Œ{(ŒóÂÎÍEØß‡=Ã}§Ö‘{tmÃ5¿h!Ãsˆ³gO$•E‚A;=?˜/}áÜ7RYJëÊfù8'*í…J`+jÒØÆy
ªæ&£ÙoÑ÷yùHô!WğøéÛËw6½˜.«'? ‡Øš– 78meLª¶Å
Êuòd¥•ôé+É–9Òúk$ßD3wr†Aàéäè¨°tøğSí*²#ÅùË¤Ñló†ú©ŒÉI|Ê×âËÁĞÜ¶Pô"qDÿ>°ŞÚàí®l«º9:™€qhTÇ$C¾îßKt¡nÉ}ƒaZ™§S¸!çx(%©@L%Àÿ¿o_“·¸wäšˆŒı[â+œ*Ûöˆîı„[,ÒjÜò©W’ì26æ­®Èáı’‹#]E¦7í>E†Gì¯jûî&ùLÕ)OaØ‰G%ÀHEn¢Æ½‚»“nº'B¼În<¤Œ¥îuF©¯¦iK™ÏNüzš’¤ÿ‰ñšôù^ÎogÉ’Æx^½º_'@öK¥·.€Še&/ çõÊûö=£YÀ/_.Ò:¿İ[0tj½;àâ,Nøª¢ÖEæœoŒÚ‚ğÙzfHáš9yÅLùgÃûfEŠ?¸Å”v ¬\`ÔÄïßÕ­ÎîZŸÌ'ê¯ğÄi0ç÷íû1ˆhºäWFÉÎó?åÎ´c¦µx‘ÿ§Ú[HÇqÌ9.‘Ë—ÄÏG.ÍÅ†/ä—(GEpW²°mpt÷#Ş¹¾ß‘:^ã­îsš½Kl˜M–èNNF9ßO.’ï1¥£2HTEŸ²P=‡{ƒ_ö(s¬ºÂ|MIW.¼d4SŠòCZ¦=ñ1v¹‡€ÂóÌ
\F GÕşQ¢ø}O˜R{Ùv_#U‘{¿ÑÍátK3¦”^öÕH}hmHêCp,a3¾÷‰ÌéßF½:‚‰W˜í™Ø–+•CPkŠAgÆ|‰Â®'²©¾@Ó;8¿²}õè|Æa§‹WÂX¤ø~9lF%}Œ«:EÛ¬áÌÎÄ68¯‡aÈsƒTXòcQ¥•×°«±åYÂ)2ö-ëÖÇ^yA+Z«èÀHïİ­ãY*”àÎ«|[Yôuk6£²¨{ÚB4u{^iøÒvÊçåg·"šÇûšéÓ55Æ|M)"
…ÂŞŒ@^6AUûr$­Qn¶ç ê¿™+Ö(¡,†a\ßD¥Æ×ŒgHPQ·F¾UCÛ„	´\š‰©ŞÎ¨²­D–R—¡ÛEi­„®Ì£qTbÃ´²Ã7®’ÁÈzõß ã1Y³¸ø(Ô%ØcåŠ0Æà°¿ó.;8ËXÈ‘³3p7ƒ+ƒ±U¹åÉ‡®)ÔÙ¹9£­9XpşhÚóZ4‹‰ºÖ./©ö‰E,ĞŒO8•0#ÓİøCp³ÇÈ	zKEkªÎ†s,–ºG}ñfš­=ºÎv×Ú1Ğy.ß~î:[¿+I¯éõš(sf>PuœU»Ëæ.G8|T$¢ pš‚ÙêcL›¼«GÃVæ³H×iŒCĞ^Â=º³ŠÙIïğ­Jr}†Fêu—Å¨c9°»½#WÂ3Æ›Ÿ¼Ï÷Ğå{™ñ'ÎXÒ³ ÷%V{j‚ã›y'ŸŸ%ºKÔnP+VŸÏİBsœbz\¬’Ì»§9o°°}”Á`ù M›ÊÈ2„œ&KŸ‹=vœƒu£şÂsiß¢WåI²ÖÀŠ=ä¦gÑÚËıªJ©…hU<"KBÛš¹¿l‚³8Yöğ$y¸¿±L›£ÊÈ¶¡©¹J¨*Z§hd´l"lD’vC«Bª¨2ÖÈğ`if‹nx-ğç<'?dø<Óm”é@wqœ]ÿub¡¤S
ãçó9üË£¹}¥õm¬Ÿ¼„½—Å¡KûŒt¶e…ñ¥Ü[ÅÆÕ“+Qt÷Ì^ÕQå9P„çßŠ²q2tŒ$8GY¥w®VVéß¨Ìë3D'ØÚÎ]n/eè—±^c’a°Û&ĞÛÛ0Œ,‰sÒĞñ^*L]ÿww0Õ+†¦ãFiœÛãAÇ”zDº#^ö4dÃK™Ë„Š2ìyˆ:!§q–^ ½Pë­T•æÍ¶xDe}‹•¿_z|bğ
'Õ!¾2éNòöÈ‰’!anf$”–+'5ôî‹ˆgîá®»Í­wvl½ÙÄ]xGX=éş;úG®(á5%'6aêÈíB’Glq"KÍÁ©Ë®‡¸È6‚gÆQ©-È,2ePğRYü=Œ»v	F^ %şX½è^¹Ô]]GÊ÷øËØ7ËÍğÕóVlöUÑÚø…MB§Wkş@hPU¸Í¡KØî8±ˆÏ1?Œ@ììõ÷—„NñqÜ0uf„”f:­Q`ïhC05¯ÚrÿôVDÜ¾3*‹ù³èß,ÑyOF ób¼ÁŞ[›‡}+FæÉòÍoJîƒT”­µ‡Áˆ­™RS J|Å«a'L¹A¥ ñeo7é.‡p 'ÛOò ¾Á²5ZÂ)£r•ƒ³H”Dù.‚‘â’+£É‚ ©\púüË¹æíÍü4 i"Ì·²ÂöfZ•òMÙM‰“1F.z!™AÀÖ¹|&0EÊÛ	¸‚¡	4…¯z5áGpV ãYã¾ß‹ª1ÑEd(4¨ëjå–øwèÃ%¶T°2zX¹öSèÜè8™	ùlÀ‹Ç¶ï(s³Ÿ0¦ C÷oŞ–!™’@@XŠ§ÊÚ|ãŒÓÁl!h÷‰awÑ[e=óÃï"`tt³T	GpDMCƒ
âéâ—B†î½z<°0Ş‘ÿÃm!Á¾‡Ô‚¬ê^Ó=”sÜ®wê»Å¿í:ğëp§J`Ó,ó&sş¥ /aÕ\2A«è“•…~Õ‡ìÒÿi®×‰İù6µˆ"~4RkÏ~N/œèâ&P6ÏÕË¾~Á¦#ÎkŞÁÌX€êCÈ¤êòûò/İÚf$°&¤w «œÿ¢?À£úÚÇõAÌzIâëõèSšyŠ$Vü7dÂäƒ#¥IF²jÁ ~ÏJ(¥é*¡’r×Ák¬µeVş”^U¿ $å{9L½QµÏM
Ü •º‚Ş”‹Û=™¢	8lïBır&]Œ›Ñ åşÙ-©a=/-n[àw^R=((9anm|-<ÎĞAæä@°öõbwĞg“æ	¼Wü>ÎçjµµÑ@¤åœ£Ü" ü,F¢­’jO8Ğ	ı!aSö£3‰dº9bÁ‡»Èb@?¡2¹Uf‚	«Õ$Ít+Ë
ì=u¹eØÒ‘ØÄcÊƒb·;§<-Ñ‡y»Û4º3_¡ë|.Ú§£áUˆ¥X[Ñ„s9˜[æ°s¢tlç¬p-Œ²#i
Zç¥ôÌÖê€7Ãµ½gû ˆªb>“b†¤Ê)Ïã87)gà#Íµäo*¨u5Âëü6É°w
¯o9ù7Âà{)¶<b¸›‚)Im½L¢ì'6™€}ÂV-Zw¥è’ˆ]ŸåuªT”Si³¤=ôÊ&J¯ÎÃÿùÕ¡5ä»ıH*áîìÃÓà,ÛÔ:z›F<àìŸÔkÌ@nÂ¼Èš»ÂÔŒuCá¼o;Ó«+u‡æµ²¤S¨>z€ Ğ‘\¨mGüï‘|µ B›ˆ×Ñ­q;ô+çŠÊú[ŸLÓe£àXË"gmo)›tñ×êC@	ÙìîèõÁ2‹›éáÄû¯b5€ïˆÛ¼†€ÔÇ×°İİĞŞ5í/Ü´Ú5%›Êv-wVl²½R!³šÇMÓH#ï´Ìf'TÂhT>æMËÿÁŒ¾¦˜én	Ø«S÷­‹µ¨æêvÊê‘íÊ½Ó6Ş4Åâ™Í¿$©ÄbÏxg¡ºTa}—_¯*ëİ¢3Úp6 ,Dgd„iá@ØÕİş*–y±UˆeG¡ŸU€0¥ú¡²x ‘Asg˜+Jâh+Ãí„I­Ö<¼!v	ïÃ]±†+Ç€Ìñ’K{QÛIÆğ]/ÑÓĞáÏ¿¹#ƒT“@Şùğ¬á@µóY° ¬šáo¶mf¯ƒuf\<ÓùÉ¶¶¼´,™§P­ŒJrÏbëNÕ –“¿—şuê0–‘Ô/›~`µˆt——“J
=BåùzøfoS•ÌTô¥2RYGë¸>/ü‰?Üó^×ş©¯ĞÂ§ÁH”5‡¨Mé½¹Y<2ØsØ3ÈCGîC¶‰fiY‘$¨?;éÉ9Ërê7Š…ª‹§cg*DIöIèE3š›íî?ØÈ£ı—¸¼¯)a˜«×áJ$"âd^Ëô"f£oYÁ^OC»@—O/’ÄHæÿ^±âá~ÎˆK†SÈ6ùî)ØÂ²-|xW\Â§¦—L#àúf#xÄævUy˜®ÓÏÈƒLwN-víúš\ë‚Q{¦ñW“A¶£•¥Ì‚8Å<„­Ç¥Ä*‰jğÃ…PH'×‹wÈU~’Â1ğÃÁ™¹dİu9æĞÒ‰´½:¨á¨X2(³ÀÌœ¨„Ş;¹®r¡ôÚD˜WJbà"òÃ»ÊåöâüÆº*\”?ƒ²*cÉÆ!IB1ãèÜH&}+6°ìÀÔĞF‹%®_•¢ë^PÑ‚9!«á+±—;5‹/Ä…¢dù$*¤É¡TohT}/Ò“Ÿ"}+ÎT²ô‡Tü/~‚¯d˜± ¸¶N-1cÒqqE§Z³ˆ.Qin/œ«»	©<W	§Òñ¦ıhğ1Å~Í|()X®¦š¥1÷†õ¾ÌÁÛD—c­mû…¡ LU—©s÷ê½1­‚¤JŠĞ‘ĞR•ôyeÔÃ¼vtìì,/œçº}—mº23ş'êºBX’J˜x‰îò•«¶Œü.*EDC$°J<z…®	Í¼¾QËjÉk%=´®·ÓÄÒ¾­üĞÉ­`q&ÖN—½9zÎ7ş[(%f¾œ¦[gciÖH©Î—wÌè¢TÄ*’çˆüÁ…Ì³Ñ`?ò\¬m+ôµï„}ƒÛ”hq'‘Èªà–~ê¿«¾÷f¿¥ì%¬(=É-´´dşãƒ@ı{iş#»²“ÛıÓ­ÔuND«š%*„€1nAH²B§¡]Z\)=ˆ9RòË²ªqı>áw„V…pÔ3ÔD+†Û:ëÎµWĞ*§•º¾:€¦“Õ}İd»’Š!•iøN	Â?2ğApóé¬ôY§úV_ú N¢,‚NíÄ¢°Ú—¬®ÆÒ!	ƒVğO°m–ú{:œ¬ç-H;PÊû‹1‹'”;ÚØæ›²ƒe| “” QDØÉĞ(İ×rËÌ¹@Õ6N5¡NŒ_jl5 +2zn2U—	¦án`wÂ_Ï‰º#¼S©Àğmt˜9şFø­‚ól„/bô¢' ‡MI}GÁ‹ß¡Ï¹à‰½Ş_IÔQJgš7z´ÎD§+q#Cñ_#2@ùnq_Ñ3HÈÙÏÓ®AY£&Àp`ÈòSÿ¡½KY³P„s9›q£+>«0Úå!dYÊ?jiGU×è—–uœh‡vI-Ohö)Ç ¦>Üp&$ØÎ©¥xQÇK(<”¸Rú8áív¬J(2@¡&X8%´¾ ”Û‹ú?$öÈŞb"<ÂcŸÒo+Şâxmi'y„U¸=uš¬™pÇ†ĞÚÉÃñôÄdíúª[1šÉİ,g¨P#ıScÕŠÄt3 ÁtS0¦‚&8%!í²*òš8¸éš×>{à—ÄCô)&'}[vjÑ)T*9•õ¼ung;?kWMâ¡'Ês¶FæËÕ±„]¥ä^¥nØ–Yo®‚
;oÛvşàCÊhH!Ê)œ«²áëá”¼È:óÈğ¢eĞX	ÖI“ËP~´S¿DxÂæ	,ÉëƒQ®Ùş`8İ<˜ W[ôK{?â|O’áµ4…#Uô{|›~›Ì¯Ò`·ÏµğÎ‰ñŸé@`|ëyWmã¯äñª;ÃVÜ4]hrN)ÆûôxVQ†}º- ÂÌ^×dBĞàç’_ªO‚Ê¾èÚÀ¨ĞmÔÈ¬Û.ğ—!­cvò{Îyg‘ë	ÖiùˆjïáYë]]zmğü!‹ğMÇÑ}OQÔÈ05şD ÖÀÊ.(œá6OšŠñ­g
„[xoŸd9•*~—€À·ö¨dkµ+3‰Ó!¸:`¤+ş´ù'èÄËÔ³HÓŒÉÍŒ£û—±ñ5ı¿È(€ËCW…Hš.¢cíK"¾°hT‚—ÔJ3İ£Ê{ËĞüñ3`4øT.Æ O­iõGxjèübE,&ëÉŸÙç‰}ÅìÆ"3·ƒÂaeé©£zPĞDš·è©c½òTÇéÑšÅ® n9Ê²gj`V Q9ˆâºòÜ»³rÖ;aéÖšEkœüsÓ¥º–Q¸lÔ‹ùà Ç™D”âdÁMÙÖ—åîâ—­¹ÛØfŒºs^òJÆå *È¶ó­ğ:YÉs¡ìIñà#ˆªöÒ*jÎæ*1Šé6<ïì.oa„Ì²œöÒI/Çk¨ÏÂûC{İSæp’„z.2í­ÿ’ÎõÔ¢Â!ôğ'c¯È9Ÿ]òŞ^Ğ€ört¾öW]¹£;E"'±â]lbù³R«lk>{Û-¹…•Ÿ;\Šïµª¦Êè<İ‹„ƒP#wè×"lÏöûMæ«ZL¼YÍ>õ5¶ŠÍt»·n,ü"+£ÔpW,|‘ÁlNâ{“XXA‘á¡”tèabòû0ÚâÓ’fÒçÙøŠ¶ Ô;EûF®)nÆF80äcHcÉ*—!•¯ŠÒó¦ËeSúAãbI¯w%v²•ÛôG†5`¶[±’Fy@ÔV‘3¼0®I|ã}Á²CåHJ[¯^f¼—X>Kú­_†9còßÜm¢FóÔ ä3¡+Ü‹0Á›¾´XÊ¶gùşbšİ†m8Â¦’½»Ú•óˆñ¯'T
š1Àc:£4{íñl’ƒÌP0kÒxúÛD%Ó$wÏøœcÛEH«Ã Jhx¾©C}?D‡Î§	ÈD'Çâ«ç-»0¤›Í"÷›(«xQHGR Şåü­vW
3]ºùVáçxC€û@Ï£Iİÿ]üjÜãs‡?7>şçöªÕéÉ‡„EÆ}ìi¹[¤${Ã‘Z­e¿ì‘¦JÕ]‘›ö¾ÏæJªœš’JÉıš-HÚVP‡í%=ŸõB²¨_S·í¨´Jk»Ïù4Šh”“€G:"Çwø¥*tğ’!Ø±åÍˆÖëíóÔr8\ø˜às@11²)­J q%LÑ'P¬İ#¬ëæ­£eÑ8z,×w|€_fx–•Ó 9Fã’>^_KòÀm[¤qG
7îµ¥È,ÓŸNf›DÙ(E[óÉ˜#gqµõ µHÏ³tíÜóÛ¼ûÑŞ€—;Á›¢Ú;ÉS¢Ê2Ï(6š+ê½ˆÄAĞ„îçyfÃÃwÔ¤Dé(É»¨ÀO\Nã87H±‹ ãš´ÚÑóZIÒş(ˆ0oºTíg—lF‚ÎBêP«xŒ!ÒLÂÔ¸ôxµ^ËƒĞ‡ß˜üÅWÑè)péB_Z^GÔIØ³ŒÑı)a¼S3íO£*ÙAôû£qh©i&w®•´4â9´ÆÀ·)]"Q9ˆÁ¶`>èd£·'£J%ÎãÃ·8.ÄĞ&ˆlGMsN´HH„“@Áò‹§V-x¥·Î<^Löï—”bå	vpÀ¶y¯D>D‰Ì”Óâ"zª—ôÒ­¡‚|¯l(¯Ä†mH–Ísÿ‹S$ƒMÿŸK'\„fvç:Œ6%•¥bb¬ì[_^X1îôCAM\Q#†ÆèU–µú*|JdÜ»]¤“pªR¶1å¥”.+`/{õàB}¤JŸ !³Wş‡ˆ•“MXè‰„1§Ü”Sû¾÷ÌÀHĞÄĞ¹ÊİïDĞ¨]±9Z"9YàgÕ	Ò2Õ4B?v×h£í3Ö‚ÛÙëï¶2\ï•s™M>GÕÔğà|ö¹
B7rïÏ
İ+]ßİë5òåÂÆ$Y\2šlş:§ğB²ë*óNà½v¥—î¨P(wŸÂ()­s/^Œ|>A+K!r
JuMÚùé§İf[`‹FéƒJü¦>ıvÌK>9‹XœËÖ˜¶©]² –¤Öú15*Ä!,÷¢#ËäÇrxÎ#.»Õ¤ó}Êúè©Äo¤‹mºL?¢\†Pàu“Ã×‹ÔŠÖQÍ] Ç?ºVß1õ~ø[éæw'ûŞ>Æ~yS½Ïƒ«¸Êm–ß;PàYÖXÅt³j"×çŒ{"¬ Î÷ÇXjXì&Ò4w&Õ×w²ßÑ«gÑŠ.7`Œ®Û¸=í.ob/cr![B­ı—ÓdÏ)s™g¢øÕ¾~¦®ó—çÇ¸·Ÿ¼{y7ÄÔ9£§Ë‡›=[”Û«ØÍ™º7^l;x¤h¬5v©uÆL°‰Ã×òÚ@Ä¶Ã¶ná#`õ¶‡„sèQø¸0›è[t}\îıê×QÍ%cÓ÷ñc
~/(Óû|bÊ¥<à´…ÁQ Ì.Û'sJVÆ™â	SÇ+ç`÷~ÜÓ${8Dá1$+Üåû½©·ï>Áç,•ÃçL<ì_Fı©«ÊäB¦Äô—Z/JÉtµ†"ÚSU’ëª Åê…s>N·åF¾Ä•@Ù«Õ‰ĞrH=~v70¦ş¯>h{&²ŞºyŠä[[ò]hÕ·ÎéåneaVÂÒj;è5 Ú:² 8 æÚçS°æ‘B,™^I–ºhŞƒ4ñ£4ñ?Lßv=?UWİU!›Û‡¥0\¸uû‹MMèz@9²²"@Œò2ëP?[ôz€bØÁùî›ñ{
n4BÛşxãÁP#nŒ<X×ÌÑø>ãÖ‰èü–aı’ğ?’ê%—ù/±ÒÛ çq´ÊFC	*e:¿Ûİf'9Ì¸öüäŠUğÁWuOAi3)”ì©¿4\‘µBå«ÔùÖ“«M†~`„—ˆ‹å	ÈÕ‡¶%‹õg²õLPKŞÌf›Ó’5±©§ÿÑxuÜg<£ıë5ûÏ½|şìî®eh B²ãô„À¶*¡‘a¡ÿì42À/4B@”(÷A·Ø·Dº“5É§õŞÖ±½•D¹v_‚@ËÃed…z/¬5Õô­Eà;AãRC6©\ìô•¯Õ³`;*H8ï‘ŠrÅÂ~Pï‹‰î
gA*ğ3éøC°Jİ"ëò/”Mí—^×YV9¦Üók#TÖ	èI¤ùóXK;U=v£®§z‰&¯ö ïáªX9‘åSKĞJÙbŞ_ÒixÅ)÷M~ñ Ê¶î^-ÄçÂ«îw•#xækî°óQ(C‘I¡bµ£5ó¹tİ›È7Ò"·Öá¬5wqˆ¥!‘'KİØb S£4=^É(OxmĞŞ6§ÔZŒÛŠ[É—ÚNÛI®P²ô”z´>éÌƒqgIÓÈè?Œ½kŸq$.x„æÿ”áü¤à_=9óDÔğ3ÉÃˆ:…Nç°´ö›špÁqá	‡mä³áÖ46tnïY€EÆbtO|İïíü^l¦ûƒ¶Biˆ¬õ`ÅO˜úAˆrV¸ÜÅE·€ŸC?k–âåFãR²^+veïeÉ"9²Ï‰7W1¸¶ÌpaM]9˜ÓëĞÃi<lA¡wÑL!”UxAöÏOµSisJxDª‡ÏUºåƒ¦ñª!²ÍBÅ ( ¿ÅËC DÂ:Q€##­éİ°ÛK.ñÔı¤ê5GLEš¨ü¯a,b£‡ú7“¥& - Ø¼aD/Ûa-İFÓ’œ¥xÒ4_n÷öœÿ€ª‘*WPÚÖ±İY¡õgp%•ˆgSíñ4S¯Ù„Ó.Èúu‘WÓ°9¦nĞQj;¡ÿ§·gñÎŞ0fõoŞTJÚvvÅAøA3@Ò¯(¶níÔ±ÛF_™`/èab^¶V;¹NÙèf™Ô›+ı;®ÔäfëÕèA;²œıhï£¾‚Ü¥óK²‹ò¨Ü”¹Ùò|bzg-çûâ&QŸ³¨p#œ…š¤®¦”ÒZ"I8ùbYÈ>§f2Å„Òª7Îu™k‚‰\yğ®×pº»0Ö‰PM^ú›„9àMy¥0%Œ°M¤ü]¡µkr13”:ÿ)õ&"ƒõ`“ÔX~KÈò<ÒŞ€Mµ7d#åp`-ÊÕyŸWx5q‚éªSæYÖpk+B´íUiqgmyyL*;Ò¹_ºòò˜]£^i«Ãª€PZÿy¯ :‰¯Ô>^¢*Ã—7]‘æê,s×Åí¬z_<\*ãéB‰<ØŸ „jÏ™i­ÇGãÿÄÃ«Ç®.ËšÜDPl¶™¢ş¤Ií4•¶^Ët¹všÿq> úˆ¶:Šu—ÛŠK…cø^TÖV+Ò;b°ÍA='ïx·`íH7¼Ë(gQÎ¥zåE¬/k|#G·«ª† A7âtÛnK‡¾şè ·8¤™äõï¿<2÷Ö|ÎÅ¢je]hTXó<ò©ó¨¡5ÓÿôiUOJ1ïAh')	~¯øZ=—Ÿ¼ÿ÷r+şzĞID†€…©7ßî$Øò­ÆõÅÍ’òÒº= ’é»%ìÂÏüİSÕŒBû‚VÑ_ïú*od5+-·$~|kQ/?õ9Qïp=-1 ¯ÇT0X˜DN_Êìÿ{	üİDï”>`ïÉŸó7Ÿ‚Ãbñ2!¡æäâ9§¾xsÓESã!jÂ¥£@ŠmÄHŠyò‹¸“{)92şøu¿¡ˆT[‹>:ğ<m˜77â¬xFÄW’%ØyÁX!ö­øªÜÖal/€ê]œ÷	œ„­'IOˆsÑªÊjXĞvWªQïˆ=·÷È™2PôRsğ¦+£âÅğuZÉ³urÓVE*Qh8ox
#éšØô¨r9­µ|×Y„ŞéøğşZùkeî‹ßñ4ªBÄŞ´ğt~?wìR6M/’4RTö¤H{mäÊì„|õÿmL¼7é´LÃyOopo¬y-Øg>cvDÏI‘Ví­^Ğ²›Ù–«»şKrøËÿ±´1•›Ğp
Ë/ta—~é-pPÈcêÑ•%LÓæL3pOæfN0ï”(ƒ¿úMÄÓKX–šUDè™Ñÿ»„cJì!00/šRr]OMI4eC"Üx²®Â&B |%ë™‹¡ŒÏhµ²Ñ§
Tã™„¶ä @Rux½aâj®¿$Tz.Np“Çº1 Éå¬Ù@Ë=£zzñÖ!'ã|cUÙûX±Çˆ“Š^f|¾,XEÜ\º™vwŞÕ~®ëqGnÄU\¿½| 'lô¦Èˆ‰UX¬o”±È	y,C J&Àb·'KKGpãı¤²şE#»µÖFãôuCb´éµ…wËäîEM#-WJn£b&eëBå,‹P€3‡í“r×*Ù¹=voÖ38OdÀ‡£ycæ¥W]@¾9Äz?”š_¬æšSìcÕßJ†îU×+Y‡†»nä¥xı>.-·Á-æıtt<î•çÆZ?-Vâ¥lµŠGdßø™:£$’¢cjoûºhêÿÿÁ	î±o„vĞmAë& “´%_şÃêwCëÂÛ7p#«tdµ*+k‘=eó*áËêšÓF¡2ìûU.MËËB‹€(§Ù^ìº
ÏÇ¶ øY 8¢ûO±íÉ·B;L‘U½ìÖ¦´=/3ŸÛé´·ïO2DKÁ¿j]¹­Ş›8Ôòà¯µË³Âèb¨ÈÀÇíÜ …ÓÅøæ~ÚØ:Möh¡tñT›m­vıåÁ{Ìõ¤r‹ò®yaäÄ#Fl^´Ó…ÃÊÍd*õí€èXK²IDWîÉş´áM S62‰ÆZ Ï÷—y«¹bĞtÓ~ƒƒŸb™İG2´NøÜ&y4ë€î?di` ÈÏÀ„…ª¯s²†öˆğ8å¬°œc¡<åˆ–Ö›‹Ødå©{ş¯wİ0Ä|–x¦Šœ{Cç
i¶ğ?ø¬ûºU›·°‹îEû=µ^Y/ñÊœÑälÛÍ‘TóÍ\ıæá“ HRf$ØíFuĞ¿ºä¤µô?ÓÉFêäRGîw¥'79 êa9|µtr¿™r}¨£I^¬×Î!½ƒT­JW#Çpt R#q€5„Ødº¼µNd“Ö¢[œÔ… DQ- ægó·#4âiY¸<ªÀ5çàlÛ­«¨yV÷¥Ö½©&„r7a’,8½ƒĞ=d`UÏ­Ş‡b$%(ˆ+Ä/ˆ…“ÿKôu:P¨Ö{P›Óv€DIÄ<ê®ukœ€ÜYSx¥­…ó/lşæ²öV`W§Èú©J\¢£u8Í8m(ç=û+]?Íƒ²yl0<î8@Ç4—/=)â7âuKYc”œ^êy[şï¦Û”*—`NYªÀfg¾İ1òÈ·èğs—•XSŞqMôü§;Kô \æqŞªtFp`v^¹y ÜšNñàİdÁñĞm¾gOúƒ?@Ñ7‚ƒ=(·ÆÀÜ¦ä3áUû%¦ãşH(1ıüÙô+â©BÑcx&‘zºø	y¥LÚöÛzªu
Ô lÿ@M‹-—KüLÑ#ãeüU_‹#¼Ÿ¾NĞxµn$ô„Ó¬öçï(Õ9wXGäucÄaÂøÌ³r°)±”–˜i¥|Î(±¿·ÜÔVçÌÃ˜·õŠH]$Èí^«)¢_~„1ï!ô»À>	>»ÊçÊ¼ı?Ôj0âƒâ¹5’qk#n£¥zmğíĞk[f•É:pÖ<^+ \Ñw:Ä™4€ë¾q³Aìé•òS¢†ˆŸ%­…°¸»+İ²ï2pï E¾²†PÛ²ŞœhTrCîoxm2o¹½şr&z×°€÷ì+qÛãÍºtÿškšÈåä„ä(ãİúMN‚ˆ¾^Vk¶ª˜½¾Û4ı\>¦rÁ,‡:Î$VÑ… 6³ı&Ó¦jU>•ª¢ƒõK±/Ôï¡äÂƒ<˜óìŒ‹ø„ïFëGšCu_ñ¯WY¹×maIÄ¥šÒ’îá£Ø¹.ı&„C'ğ0Ædil$ÓGA%IKüû{‡¯C%ŞpsJ¦J%&Vÿ¨(ÍûÉQ
Ña}qû[òàmŞLœK
­x‹DL&8ìñsÔ®dç¥ço¤ä?µ«0Ö"I`{fõR9–GŠ.$Ë¶rÌ¹
·Cóèi…·ôä•(Wƒ \×å³WpL ÂÃÖ¯ÌÔë/N&<"òiØÃm—òÇè‰éç½Ö¥rdÂw®`ıËjÕj;œ
3"q)~R«âtEN$÷6¨ı¦Ãc›áËšÈe¼uW¸go˜rGİ,#@#ÈÛš~Úó,6W0—KÊ q+D×ïYË•Ùñ‰€ğ]"À\§„¢é²û×ºÏû¡‡IvÊUpş×¥Ö3¹Ú¶wo.TS­dÃ££ÿÙîQ7gİW½öÙµƒ¿xûµê„IäüÂ/zfXúæ%“Sà´¶Ü]¡Û\CŠ,±6a˜7hDªèİšMÅ…ÙÂ {fÚ(\¤dsx$<i@y^n‹xŸ4|3²„IRAÎñ›P2pÕm=ÒÑ¨æ…«ƒ¼WØmQ…z^®	W	ƒÁV"¶QïM¢$éâ”±0ûAAv³”¦Ì$ÔÚˆUªñêØ;º´Ãîë“T@j	vÜs¥¢4ç &E×h5-_uÇßì¹å¢Y\Z©Êäf¹²Œä"¯ù'l—™Èµœ@ÀN˜#ş—î‚š{|Œ'+p}Û–UÆ±>ÊOR¶×ög¸7†³B%9®ã<ĞŒ^8aq'÷ÍsışŸ±İİw^õÁ¢ì~+¢m?Í©]ÍW®èakwk^C…4f+„CFà‡çÕÂ2<ˆJ&|ÜàNfiàÕm—¬³½ØéûL&Æ“`«3íò‹ùdlXĞVÅÿ?Ó²*ÄJB$ªN*yƒ‡Em@¤à#mY	Ñ= o‘·Fˆ!¹÷Œ-Ö"#¬Å±¼³·/Ê]!Z—_ 	x^‡Ñÿ'¾`a­bUE^;8¿ƒD<H%?z`bßï~’ñÛI…œ©|€v:_>YÉÕÑÀ	zoRî÷'ìS©[Ä*²ˆ5W^ÓµÒ(ÕÃÙĞ!³Éıyò*Vk*Ò1lƒ¶ªGg¾a´1L	‘ídQß *¦v1[ îÕ6¥…·k<âõû?Ó´„@c`ñãæQ@p£#|©ø€äØâ"…·È÷™k€R¨®úĞ<klĞqÌ~©Ç±É9Î÷bGç°Ëÿä'Ñ Æ—[§Oú·ÇÄ°b•š–âƒÎ›<
Êº†,¶×7Z”jv¥^1“àw`QÎ"§‹7t!¯ 6ŠÄ5É¼mÇGÚ#<›Ë**Š,ëî[é”ÒòÙš)”çBèÎV†é2uÒaËóüÌ¡io¼îç¥Ó¾’YÏ"¢*Œjc,¿£“÷`¶¶$êÈŒp£@`’J™Šƒ¸4ìäË¼I8‘êFQõIj9N³Ef¡òçõ™PÉQÒ,	×Š²:	°}÷:nÔ•ÄÛ€Çm¸áo×¶‚øñ|PÓ•§ELàN»t€ÁR[q.R BR}…SÑèÿÎú9ÊeØôæÖœz‘â¯6ĞW>ï©|”¸åŸ.6ÿ—B¼¤[$ntøsŒ#»Ï³åA†F÷/¬ûÉ®$EÅm-3OÙøì3ïÕ”&ı×CÚA^Oƒ."eİLÇûŒ²·ˆyŸ?"˜²j'âÈOcT<úy™õÊÂ)dXÉàÎH>´]Ü-pQI†3¯ÒJ5ÿ#ƒæÏ´²†Qq­Íœ®)2Û×-Ñ²Gg +ÿë—
a¦ÿ¨:‹>Xzøõ-</’²Qûy"òãĞŒÀ("¨ív•8Z¸	ŠZø„Ÿê¸ööXXÏ^O¿i«ÜùìÌíô§™d^ƒÂ«C÷ß£¹îÏm1ùë‰„™5»ìß'é‘Ó]}ö·öÑ`«¹l¾ãì²N¢!†´¤ÙÃÍ‘.§É<±ÜªÂ+Ër×I¬´~½+´YGâ„v¹Åk‡ê‰-6IàïEo'oè¸OMX€­—\
Jƒ‹'4G“çV²@yârÉtp‘Ò	q?¿	¯´t$•#üÎüuİù3SÜ•(×GÂÇ50•KêK>¸–ip1>ˆV´<DÍYh1/Izùÿ}ôµ«³Ç¨/+>Ó9Ú¸Üª¨Ã™ºIØš€/Fb1@œja^­Í£V&ºÇ§!ı'×s¨&EÅÆä*\V¿±M9>6`ßiv¶dPúVÀÇ¯ì·Àæ½?Ê©U‚L°*21¾©†á’åJé^F5DŒoTµÇœ%UË-º ÜØ¤—]3¢Ëz>/“¢2`æGwÎ¼íe’¦N1ü(ÑG*ñ*‰ÌÛ«¶ÌõÊŸ{²8ÖØ"(À®0r´)ÒÁW­V\ÀŞbª_£pC½ÂoÜD~r´bŸá+i>´>‹øcµ)şû@óºAn)Ì	F'eÄâ¶!lªD¥§ÂîŸBÆ„cŒ•
Ì¢Å˜ZÍ~IRŸÙÊ³wîÂ¸Ëİ“7ÌæêÖDiáEèf` îİä€*—,^UbIÌH•øÇ½S}¶Jãğ¿”¯Û5¢º03‰(.Ş;·;u>ÙEµ1õé)ô…À”Ú[ı{ıÃ«ñRJ’,2\ÿŞ~DH¨'.ö`‡ í@
mÒÈá^éãúNM` ÜK‚†ƒÔ«±¿øKCcÜdiU’BÔN^»^M‹Êå«ù‚øn2™iô@r¹¥'äµ¶&¦®„üÃC£“Xé'gRG^(—ñ9ƒ%ÿu{Ê	Q''Ñ†(f	nÛ[¢lÄ¤ä«3d!)®:Ãª‚1~Ãg–ˆŒ•C”9í`Ã¦=ÿ¶”xØ¡¤¥U3kÆÃwºå7û±³º„à¿ıPK!³ùş6¤E’Tu²õ¸gD½Ú]|¸ ú;À¶f2£Á@]w{Ì!¯~ç½6m¨™˜fI
_á³xÑ¡×œuø€ÿ<wmÓ
¾Î]qÇPËHUŠŒQ\fóÓ4å™
:Ù*°éyg˜¼xÏC©&ü}èKR‰×â6ˆ·ÍeŠvÓ!l^Ø8ŞË8:²BU*ì¹9VtüSŠŒPXzÔöÍkè2ŞpeÅO›û¤¥…`»úJäöÌ.FÚHRÕh"·3´óKŸ?Ô*ãNZ€èDï îªı"aû$¡Š¯Ü=²1@<àIi†}Ù`½¦	F€[‡ÁzG¶·«×€wbp…²ZÃ!"&‘«çòÊAöåæ_Ô¢ƒš¼¾“%½~g2ŒÅÇ—­ı~ÿ+È…ÇN7¶i
ü·gŞüNå®G4`7>¬Ç”ÃR)Ş“DŞñr,ˆY u~zÒW-;Ò‚¸µ}V«º?Xçò ‰ÿ¤v©4´Š	“¡/¿ûáÎŸ^#†Í\ôõÎ•Êÿù%ßÁ“Y±JÑóÿÉ»PNº¼jvpúOÙ+hC¾2éš¼«ÁÀ#³ Ã9VJDmá"¼9Ş›ãõxÇgïåŞëS.Nğ ó¸•—ïĞ`Ñù‰_{ZJå:û­¢5P4…¶¾¦¤`6eÕ—í(3¨Qæë×“VïäX<Ø—o9úŒ`ÿĞÓ,+ÆÜ°`eSêw•UÔ¨-€”BÔB'Ï°.’pœêí9uÀb‚ª"K—ù½iól”l°ÂÛô_À.-Ñh¾Gó†Ï!`øùÅâyN‚§e„õ¯ò‹–wœ"Î³™Ô¬mM¹…CŞä¦WhäÇ¨!ÿÎóCBÃ	+®!"åKÍn½]¹,¨óVC:ÁFïª··­™o•àfABd‚D•oºm÷Ü„Õ°f³ÄÅÑàh†¦@âU¢·áO#-›Årr7‚lîÚ¼ïù²ŞÄ´¤?-İBCyÛï)f¡‹zMiì“887ä
E³å6İÈä»ÊÙífCéGÔôıø&°–ö@{Ÿ! SÖ54‘
Ô ÖæJÖğr"yÉ"ä˜è1Ô;7$•ãVàœúÎÁõ«¾¹å	€Ş¿
<,ĞƒÂƒÊÛ:ò8óWZÅÊg%&Ğ1ÈÆü6î£À¬,Ï—åqq|ğÙğ­7xu6Àê°øc	¾øƒèBË¯ƒT¦±ækµGpá‚Î>ZO\|Í8«4{xÍFV~Î¿¹dˆâE.î´ k¤ê³¥Š°J†]µê//—‰a€FìöSøŒ¤ìÄ«R%Vø½P!l0§Y‰9Ù
û2c¦o¤î’Cü“ëÆ•Â¡·Î~ºM@ÍÃ&J#Ëê;ŸØ·.7—:[¼S$ÉDÿ9ŠŠŒîR¸69Î/D‚½Âa§6»ºANur¾Òu¼!9™Ê º«­Š,ŸÚ#¤€¼Ê™4íC°m ş~!„Æ¡fÂìŒ'lbÙ;òm§W¾_Û¿XuÜÓç»ƒÔ¢²é´Ìñx\¥Ìˆ‘<‹U>óıñçZXê×÷™t·ÅlÊP)Vy Tr&½í-“a´ÔÇN7‡%XŸy~„½ö\mnÔG¿Èã½–IPˆé€ú7ó/ç×HCY\•ĞSŠV¯ÙéŠŞµeBq«)¯gï½†â®/Ö‹(*Ïô}TÏ?¿}m†9MŞy“¬ØX™€‹Ğ‘zenªê"ü<KïÁÔE˜±ßÛå¤.ÌÛˆ¿!Àòñ ½î{ ¤¦‹]è5Õ³x›«b÷NQØ-!ÃÅ0İ˜/”c—]8r>T~%’Ck´Y-Møh´lI/º†İPO¥ø‰¿)o”eï5tºfk…¤ó´ú»î ¿jœç“à
„Î‡İ~xp°áíWò¨v6Âú)P`¦N?ÅCŠ¬(5F6HæÑ­jÓš]Íïe°È¶k$-’@šˆ0#ÙO]QÛihíû),†¬q¯)ÈµidæXÚl?û:%ÖMòTÃWÑïÌ]’¹œ{™g2ÇŸí•;ÀÆ|æD„Gjw{yæQóî€Ö¨²DVã ÷Úà«•e\Oš/¸Rî§äçùÑdhw9‰b’Êš.!Eúú¬i,9@WUW:¨Ã
H#¼ë‘Å]ˆw«’6Ü.¬TÎ’]êfhÙñõÇ€úVg]Ä…–såâ7bfuÚÛ¿óD¸¾·Ó‰Î£a÷)¬‹wqË¼CîR"‘Íz=òO
‡˜Í —N&d›ã«ÆPÓÕ ƒ|J±„Pò©›.ylÈ»ù9²¨+Œñfmô¤D9œÙÿU?:mr'\y<JG${†oÓ|÷\‹„ãÃv ¸Ÿ‘‡İ%¬D35u_¬ªß2¼u"üŠ¾8+¤§Êæô5i)É¢ÈE%Z€îq&ÎåÌ¢˜¬±P„LFŒ¡––E¿ pGùÕvgf˜¢û°ê~á—Ä_´ÖnpRå³Ø_Kx~ÁÌcôeõØùïs«éÓ÷¤¯'î~yØ›=©ÿÎçcTÅO˜ïˆjÁtş±,p¿gv_~õ„ó‚İ¦S¢ñ÷_ü(È–Ü×VQéfŒF.œéÇŠ`¯`¾¡óÂï62>RÉ²œ¬]…½³2œ¢@ÛºM¿¸qVŒÄ4Şûë^~*>›ğË!†–ˆ{½œb¯}3Lõ}‚‰ í‹¼„ë½¾b\ÊÖv3µ;æå WøŠ3Ì
H”¢¿½ úcŞÏj´#Ì”P6VAÕjgHîÀP1ÚBÑL»M Î	ë‹=çxU;Ë=ó]3N1€¯ì-õ8²ÿ…\°
L¸UÂ†€ø˜dÔîÑ.6^úæ‘_Ïş¾&–4k5u”¥¨Ú’Ÿ
 ¢ÃPE«p`~¾²E¡ K<Uh¹®`6Ìpk»h?è±íK³I·Ö`äÈ¼L…“ô÷ïnŸ
ö½2´g7ç±7RíØóÜÄÿ†sè_ààõuyŒK0.öH6À(f6~à ş15Àù[z†şX1;cÓ/î?¦J´S-Wí¬†ÈGcbÙpşÓµà¡7Ìí˜Ù0N‚œV¦$)GïXc(Rr®J»ƒMúââåÆMŒàkJ=•NÁôrg¦æ!9…2)*œíÜÊ¾lŞ?òÿÊ‚¶xè@ºNy‡æxÉJĞÄ³$œ…§=ô‹ræG$­ü¶Ågß;gè!Ñ*PÖi\µæ|Z_müæúúû/ì¦‹Û°À¾gîÌÊæjU–©ÿwT‡+D˜b	;ÂŸšS]r¸`Á|k†}F#ïp2jË½‚ÎÕHyš k­§§¨-ûA# †òŒ_MPûcH½YîÕwEßÔ®úß/Æ”èéÀâ’1c=ıã("©2+ÒAv²	ĞC’ÆXòou#Uş+P~(YLö½ˆyÄùq]¾«ÅÜA c)ÿ¢©”zœÇÒáÀ ½K›¾©ÈEHÕxÑ}x™ç gœÎF5+.„§ª’Mõ4•oÂáÔ%\åe!`å´ùóğá@’ùµ‘!ÚæfŞ¦z¬è»\äçÄ+ß_twöjœØ e’"Éî	œùòEáãn7vœ=kÁá·¶x: É¸+¬¥¨—6b„Ïª›O(r{8lÌUãGHÃ'§© °‡Šn®¦™Ù¨1›‡TO¯¼\¨ÎT6änQ67ËÑØßX–Ô>nhL£8,a´Ê[*ùuÆ"b‰‹ÑëEÕ®#Ëä‰)>ƒp=	%}DÂ[ZVÜ"½À‡·ô“ÈÌ/{{€tşiO‰·w))öaø&gML‘Où
d,Ö!º°½È$súvr{(îÚà€Œ÷Bi3ÌÚ÷m
§C(p€ŠÂ«¶^*¥ ¿k²Íİ¡œ/áÓ·dÙ eYãuÒÏß:OÇ7SÖƒ[!±OÂÃ.4™Ò9ËÅmzyq¹Ö¼Ö¤­e-Ë™@©fSÖÅQE‡C (ôŒˆ>p“@®'eŒÍ™‘
|ƒõ¨À[Ip¥úpól®?ÑÃ¤Ö–'ó ­^K
‰só®1'ÙÜPü¢9hEìÉÉÎWUê:è€hş†•M:c“nAsÒ]øĞµzµ6”`òj»Òí`ph9„ã*iÙø¼”¸‹vŞ2£qÏ4®üğŞ®FÅü9G4÷›Òb²ÄECò¥X1æêÕcNĞ~0Ÿ²èˆœ–ù*}şOGúV+ªÄ¥ÆŠĞGlh}õ^š`pãÚ2}ĞÒ¢o€0$üBéŒ6–?Ş„däMÆ÷gAchq›RX1RÙøã!òwyÀc«4•Ş¹)‡×¾ñ)aìJzÈOo_üWóc9|"6;oÀıÙøÒ!‹Û÷0*`æƒ¬0_„ïåMÍ¨á
ğ$fÀ\CA ”ş3ÿH.]JŸÔ0IkÌï{69!´›H}Ç‘½¶ÿÎ£’È´9õjåÁ_Ç"ÂK¥d‘~Šv/z·µKä1é¨"^MüE@¶áIœ§ªş;ëbÄËãßgè»ŒGa÷ÑV×ìŒ^Ò¸	R—SIU#òòo–ı»¾:rÈÛ”!’Lå„ğ½ZbPmØ‰<¼NµÍ¥=«	Z½`«ä%pî¶øñs«¿_LòÑT8‰­Õ”1*Ùó£÷½¾°kñ€™,}›²º=×(OÛ?¬N/>©39­¤àÔ4"Á{”ö8ù$eñÙ|ZéÆ·Né“Í›q•j…ÍPšÆ:w9®(ÁznÈúPèºD0ÄÓÊBˆ`g3·Z+"†R*&²ëJïğ²¼1f>šÒšgBÓ¾HÊ&§¶¾N®ß®1œû@T¬’è5´éõï¡Š2YÅ"ó:f²ülîŒòİ
† ¿v™C_z›ãÔ-ºj‘³†Ç p¥¯Ê¼‰ó{}ƒ.'–¨ÁgõGûÛšUDœ¬1@xÄÛÿ…¹b×@îÃıÁ®ªMŠŒQåGU€XŒŠuãSI@òùq¤²2ö•âej5@ÍCOíƒã «†ÖqşÍRC¦¿H—;ü…ºÃå„YÊkÅtÕÄéKˆ°o°m9Ëİ?U˜ úzX‚ØˆBT?•7H.e%Å€™‰¹aQ¢6_fUåå®+«'„HTğLÃfú&³—Ú!(ISõ—W&Ì½"á{dñJÖæV'”Ü¥Bœ°íK’¶_t«óQm5…¢ œÿ²5œ
HiíäÑŒ“…FaW¦˜o6Å\‰& ×LVÒW?®¶ÕÎr“ûæS“‚°oÃ÷$ÿÏ§b£ò®1š1UmYôó<âjfà'ÁtÌâÏê•E§¹øVŞœ¨` R¡7n3¥Ö»&`º§XÂÎĞI¡Ğ)™Ác¤.P¸ú6%3ÒåbSı€êZp”ô[Uõtî¿3ÿ ¢wÏQ[ºì/7hN†“…á¸–ËºA!_{QÚÅÃ¹Œ SåÖ+È(RN|Kâ†Ó×Ë“Ïêv^AeÇ‹·•‚PZ§‚i5ÿ ™>á¾ŞtöŞ¬š K›üÔ¹TæÊ‚õS("	¶~ü®át·Òİ\“ÑİŞ“|XÏÂÂû³áº–¨l!¹¡‹g£@{ÜI>ô™a¸ş®)¥b‹ÔØ8•Ñ'1håÚÄñÓ4,ŞgTx¶92:ÕvöNVÒvvµò³>'Àñ”
SEƒ’ÛÔn}BƒtŒk«V.‰Ò–*Á% ¥7r7±ĞüR®™Ûù]Ñ©R“0À¹ŸÿKÄ£Ûú54°]íö]Íçs3ñBâ1M«·VqĞµ µÅQNv'èˆâpa¦§\\R	N”¸v¾WŸ}s!.ˆ¯Pª(Á»öü¥ûÉ*c'ˆ'sÚ<|ÄghŠq¨ƒCl¢Ù«§)•³§ÅŠF·]v bHHdCùÔ]Û†Çšª¾¿W½Ùc.kvÆS·(¡bE\xY9…óÔ/@ô©ß œÕ‚§Ë®ß…î“Å¿2òd©XŞšïÙ_ÚñÁ‘æ¼o¿ŒØT’.1É8dn­Õt¸ŠÍ²½–1m¡@Ù]zQHá½4k»´§L\;ï‘¨/—Èn¦eÖ@F”Í‘!&ã~– ø¡De‚Í‘À.¼ù‘ƒmR6¸Õ•„SGÊ¯=©×«…r#âOÃ[>ºÒAlóG÷›˜=©é*Å˜JC	)…’@°KôDX\é|Ü!àÈĞÕ¿WJ	WQÔkÑc‘ó@î³›Ÿ>>æø’®n‰]Ëe}º,å‚Ì†CÓ¤Øª\ØÈä$!Zš¦Ês»¨ï–ÄÅE£çûä°“ .‹óııÈ\ò/×š½¬êùí––‡ù†vKÇJ:Ià†W*Ï.q
g@1c‰q‘<ÊĞ}Ò'j]4¼`¢³a'İÇòqÒÆ1œâ{ÍŞÇsw’¢•Í¢âü‰Öëá…r€ˆ=å+ñµ¤“oñªäÑ±{Ü‹Ãxùa‰BÊ1ãÛ¨û£Ã¶eÒƒZíCvU/ş/#gw0×ˆìÆ»I.£ÏiÖ_´ğÈÆ,ÖÉúºÉÚ¨ïÍ	G®Ëx¦iØ»ò½Ã%iJÃ‘<%eo,û‡EÙ†ôËFv‹ƒHÖÆjK"¯ğ¸$ëĞıUr êï˜uºnóqï}pú¿`ã;¤D33îE|),#'åº/†~a‰‚-¨@Èë‹Z!D®°4‰µ%hË8Í£Îî.–±Ò«‹ê÷z­YÌKB.zºaÌô{ö<z’ß€lMÎÁË›öÃÏZØîÁCád[•Í‡K¾³Çˆn¨ó0”¡ˆ¿Y.
/,Iï>©*Í¶‹¶ù¹ğ’â¬q%¾éF™·%G)èy=Æ](çC±³HGi QOAihÆò\ 2˜İËY„˜~Ô–ÔMÿŠÂ([V§Ë9—ah¶j°ÍvÏ`ñHŠˆ³E}‰(Gí…²ˆ)h+Çá>íX÷–€-Óù{ìã0ƒ Ë¼[1ë('FôìØ?¾–_ü8•¸½b	ÿk\H1Æı>3¼Ê*ê¿ÅMAÔ2@_Ú\ÏoSbvÆi›~Y)eÔnİGôhˆ_ì¸8´¿G­‹²wWUG¨Şm/~ñ¸ƒX8ó•dåÿsÓmRı§e¾Z*×ªÜ¥ÏßòÉCà×öÈš(á+6nÚV}¾“çÄJ!Z&è+İÉ»ıO×ÊY´1ı¬ÚNkb¨˜‡¨|ËçQ ,!¼c<
Í	ü`7ìØ¡w^Öx‹ùã–²VÁ Cîàäíssİ.¯RÉTá,v¤tÃl/ƒä=Ä1X‰ç§f§Ç÷On®ØòÇ—/ALÏMĞİ{Â¶$tÅŒ,³(®òØh…eÙîé7EÔQj©w·ä|¡;ö?LşM¦ÚVˆÅ74yÈé?/NzJo4ğVÓ¸İÍyÆFfw†t;—NÁ_Ã
ÿ.>­Ü¥rÔ°~ÅÕvrêYu¾y?±Ø°Ğ1÷ë¼å-„íMìˆ£Ôpfc”ƒ–¿8±ã'q†ÒUA?¬?äÔ©¦u=Q%z!X«º{Tç$Ü1œZ¬.·)köïTqüek¶Æ,Æf²*¯²æßõLu¹{´%É–¦z‰Ù;%‚LhõÚ¥ìıŸ¤FŒ²VV‡
ŠÔJØJ)U…"Ø›,KŒ(;i[­IL*4 ÿü/–ÄÑcQÑ§™}&¥OïŒ%ÀG°:şÏÜ¤ÿÃÌƒ:4–—½€¿BÅOî&y¡ĞügÁ8iv•.ı[îëmN2¯Ÿ,¤ÃA}	=ë£±E³õ0c•‚jÀZ¶Ş0›şÙ.•_„H$"©"õLfüa¸`+|Ïj‹ÂëOnµˆŞÒS¹æJŸ%ü~õ€lHn5g?Ş2ÔjhÄ<bºTj$ÙäÃ¸nyôû;úE(ÅÂÈ+å¹Ç¶°´Ö´¤(ßŸüâì¡bVÈ&+­»Ç&uëˆ·”İâoˆğÑ°ŸâvS2µ+ø Àn	»q£(KŒtÒva`öoTób²‘pµæÆ-¼9÷K„73maµÄ›øÇ}CÈ‚Ÿ‡È—ÿ=o×†ü|@t¦t§Nµ¶;l.üy!á5P	X¢Ú;'\9ì¼YÓí¬Š}“3ÚtÔsëöá¢ŞñÓ?’@©:¤[	"ü4vñxzÕ"–% @Ğ&Âö¥» ZàW:„
Ódñ¼ÍuÖÎ2~Q¸nyÄômpÅÍ¶ËJ1Ã±[K0n˜;	@x1cøC¯œYfêá¸ˆÛlz$G™[ï½)ØÜcÒö
İÄøfMˆó"í°Uk{êÇ¸BiÊŒÅ‰0a¬šñ¼3@¨Å°»¬L=ŒFJím·OŒÜyéX*FÂëYgÙ:<Gç ]cŞ!âèùú1¸kÜVÇÿxh£ù«)ğq™~¦'?äÕ»oÉÁÃxIBlŞ›a-µo¨áæo,ÒÜN”b\Zì 60•ÈÜÄa··îÑ:÷³¶-å$’Ö“ÊÃ0è(erÙ€:‚Ö•Ó;áe¦ÄÇgùzÿãğ`Û/…Aà§Wfz½ ·–.bÉ4ôá^™Ø(`-‰%Ê	5üuXĞGïÇë÷X—T°æŒ¨öè0pZÚÕC™í(H|)Î¿£Ğ¹Ë[ÚÃ
 ‡æıÚgyì8(%)Ö2ÀwºLäÈÏ3+çH‚Íšã}¡£J¼Û¥cúÒ×§3–ç|}¾Şq8XÃ½e¯z–Í&CË’I=K\±´UíÃ’ûĞ\‚§ƒjh I«ş†³ùES¨k|-5uŒÑT ½0y'
Ù9§‘^…Aˆl:€¡úö§
/ßÈ£²G=~Ën¼ÊôP{æ_Ø­m_âä`î?X ÅåL+oiïò¬šN²ETpÂU+·Ÿ qkV_u5‘V;‚öˆ^ĞfÈ\Cb·[Œnƒ6’ã8”1C"l<0æS\‡#§v’©?ğÌU4ÇšC¢p‰6ä$/"ÿzì‰„xH›ßÁ;¹†í8mWâ‹ä•¶X ·£}±åà°kuûöŞÏ‹œ¾cú,7gOã+Ü%‚²´Ø‹¤^(†­\àôD$1Àqs:R÷K”œÚ5Í£™µo`–ÿòçRrb¥üö1ÁÑ6ÖQéd†R“EçÄüğKÆ«MÆ1jM@šw2<s¼Á¾×Væİ”ï$ˆªñ¯ªPİkSÓº-S*¹ ©IÖF­ññÎ&IØé–í¢d±úïÿ—w™˜®3:»ûÁ™Ãƒ ¨'e‰÷,vfï+mÄÁÈÄ°$ÕVäÆe½ĞÔ¤[ÁÊD,1¼ÌŸF"Š£Úø^ÌèÅ»â]fÑ<wîo>­Xi]ç0ï£ô¯r®Ò>øLeÄÁRX‰ÆšáúTR ãío% ‚îEP¯Õ’²&‰¸ó!jOáèšß$«ëZ›<ğó£CN–RR¡·m²©j+JŒĞ¢' bÖ¼#¶ñ‰ÖJ×ì|õÍCü”Zèq\g'<ãÁä6ùó÷³w^Š¶†LÖáKT¼

Ø<|ÎGp#ú®­B,El(dls¼íñ_¶„á~
€Â•(À:
cqEs¤FÈ:†DrŸ¦ +S—{C3ƒô>ñ”³Ó_…DÚU¨ßŞ¸dŞ[ŠX;åû¼•Ø2i0A3Nß¤”ˆ1¡VıK.5Ø d›8‰£ª)}RşŞòÒ¢,D…«v-t±ƒ„}1ıßÁc6jh„ÿdèàùIÌan%Xı˜ˆ h)Ø®AÇz´ ?Ìw×'ß©µ8ÁçV…Ó,×yJWx$òÈ)`÷—.BÊçÆ~¨ ü }1®†9Şh'ÇJ á—G¾®0ô‚ÂNàã„z81ñN	šËDò’†&MÔ0W^š1™÷fU—Óä™¡şpÖù8Eµs#²â&',¬Ó¹JÖY²„ 2#áæF³©O£=¨§!R‰d8òhG¢®„°(+À;5¢>ZÉbÂô'ëBH G ±¸ÍÃ®Ô2©ˆÖ©Öı&Òƒîr>Fwo¨äØ’:" w¢Ó?‡–!(H¥¨Xáü®Q,à¹Å½ËNzÒ}Ø_J
'mßñ¬¿hÔ
%4½åŸğí¤³W¾TGîH˜©•.ñºòç8±·Ù,j!ÊKĞahÉİVJ¬”É	•·k‡ñìšr#ßëëQK"_M±ò#ƒ|ÁšŠëèÍƒ¡‹ºnËRZPyÁ¦‚Êøg)‚ëàƒB ô¸öjZvÙäª?:4ù;^fÄf!äRäğšmÃØC:dP,Œ·<Ö%^L±‡l¾”±’¹^GİÇÊIàø‡ıªë©Â“rñq_7¿N¾ı±O@öV
ùA(ĞLî6MBÛ]xjVKî	¦õ"2SsÉ1
ŒùÏÇaì…jÁ>mAòÎş>İ/^à-L.å­væmw²2}3;±‡úO?vS~åß!À3J²™‡ŠxšÿÒKéEõ9‘<‘-61Ã(%»ĞZšÔÕ^ò"5´¶BîF‡¨¢ÇP§vâ@¶H±Ã‹$‹ŞÉGë4©šlİ16È İTp¶QÕó/£ˆe+ÀÕ¢Y±æá]uÍgô³Ö&è–Åb¨˜nD!µÄ:§–ØŒiA2E©Ho’Ü.•õ5ÜP—ÜÏº…Ï’v0Š8¸")V$ó'˜;»ùÇµ¾œ•ÜÆŞ¼’Èíy[Ğ;î^«Vx6¾¼»†>‘4EÈu*m‰êDP‘'©	2"©{(ÄmC³|V€²²õÜ³YÑÅİ‹\[5ãv: JŒ£SÕ¼˜JW›)òìŞŞkhá÷0æôlaĞ8Ñ}íœ?G¦Ã8tî¿*Ø» Vò®Â"ÖæôÚ%7ÇBKş‚~X‹oàwh&Û…ğy.XÕ¡Ït¡õ~N‡­q©qR€{æ Cy²~×gçuÔ·ñÈñ`TlÒKho9®x²ùÁsñÇ¯ËROúa& U®AIÀDA:…_yg@. ÉL†`ë/°¾œÈ–»»‡)øıvÔ2?¥¼'Å:sìì@2óŞ{5ö©³·™ÑklµFÁ“~Â™ã&îQ*Şúş)ä¶mnj,D'ğÔ\*–Æ'Eú‡ó¿±V¶¼®mù„`^Œâ+MèP0ÌÖk×œÉJhzsz è¶yxıÍÒ÷]öXYr'×­%°±}ŠªâãFÑ.ƒ€Â¨ºû5ÿéÂ²£¡”wkØ8©ê~¹]äìŠ>[kşøµ•“®Ãz5%Xşù?-ÆÑ¿OTWæ•ÅZ¢|X£h˜£fcí-şøm.3÷ûßQrâÛN­ø¨)Š©±eÂÆÓ{ÒÃ#„ĞK¼İ0bV'ÖÆ„Õ‰S¤sÏAíşç7Ú3´#(–ù÷‘%÷4™`é38)‡s!l½Ş¹éf‹"öÍï£ÈLD×l¡É†è¾Mø2áEd¸Ò«°–^ä·.Ï¨ô%%ñĞ8Á=l™ğ*÷çĞzôDJÇ¦Âµhß$ŸËÒ#:Vè2lvÔ¶ıså*(Ÿ^D8or:xi®­
¤¬Àï	Çsí\¸ùó‘XîHŸôôŠ¿ñmÎ	—ËFakçT¶ošHn—ëWRğ¼K(ó‘ı¨Ç+âXÅlúõ0÷Ú›İ(º%Øşv¤‡‚†…üÃ0FªÚ0)öı™?IÕ"f/Uhùd"ˆ"+åÔ‚y£R¹›ÿPüÏ¹øñê§yOïCG³Lû²¼X4G|a«Ì6°†ƒiˆ»'w9ìÅ·¬0Q7«õ<Šø|^FhµĞ¾?ÈÛ¤äUè[ÂÚPÇœğ¦³@Š)©÷µwè_èB%â ›» }ïşÃ~ÇWışØ×p[©sïˆöŸVÂ‡™ÕúØ¨‚2Á—	±w€·°|OĞnç[~¶ålÈjğ¥KÌoí {‰[¢Ÿ‡<òÑïáÊƒo~&@'¶ÿû‰úPr=?€½¯AÎ#„dÙ£7MÆ°NŞú—ØFÌMıj¹G¯ÀÆWFŞàæ3sCX²¬wôŸb* ó¤4‹_ı ‘Gê“‘'·	/Œ,ı¬=¦Sêå˜âõ–e…ÄÒï´M2mÜ>÷MA‰
Ä¿”2LrìY‰yüÂfgœl·PY€ÙÅ…nåÜùxî§óÛ6aO™™"ß^ì°øèÀŒvœwê³î7>gÃyšj“U¡B³×–[¼í
jiDJ¥Y;¹	–mwGëè=d*ˆUsî"Zf‰«¿j¼‚Ş/8¹LĞoª(íÅÓáf2šC$‚ôÇ	aq~/•Œ3µÃtª?ÀX¥«2â,lg+VGıl…Éªí å–â šĞŒŞ@Š÷aJŠ8ß#ó‚cæÕP[=âÊN>ˆ"T­c¥1ôON©b3ôÖ5<şÃ8|	õ×[Òz%\8&hiî‚eÜş˜:¶éËÊFÈ‡THÅ7w `¦4B©![IaŸ$ŒH“«2pK{àçš:_~ÏpYRÍ7è•Ë§Å‰Naìs4Í§¨jßÊÔ­¶rí-$%&y˜ßy²„îËE·çÅúŸãòÇ<äQxä<ÙÈd}Qº'$ºhÀ85œëMÇc
š!îzeœa¥WçO¸pá÷X@@‰éhâ‹ïlşq‚øæ Í'Íí6Ö’-¬[ŠÌ8Ko…IwtUùÿªÌ%W3Æ¹§pÌt‚Ò¬ñÀ«*7Õc±ğf‹Š?‡f½2dÖçÓHUü™®[£ıüÚ _[Â«Ğ¤m{úw#­î—»L¬ \º\XD+îøNXB¥}åtÍT;5å¯Wª`
¹6IêÃ&	*šÒ'Ê»z6b‰TŸM†¼ŸÒŞ‚KÕ)¾y0´Ä\ı¶ÙAµìµ^|i/Ô#öÉíEHxÇÒ×ı¨Ó£9²Xš$”°Çù# R¹!:¹(-ú0ŠB¶=‹-ÅaÎ½w3Ñí<<F(ã4§í;fiø6¶d¶Ñ§éC~‹ÌÉÒÀÍ¨—ífh›n/(y=”åı´%¶¢x6¹}ÑŸ$é©£]Jè,ƒZDâMXa'¼Û?•®×N-pÁİëí(Åˆ‡_Å¼ub‚–ë1„¬úüŠìÁËµ0. ‚Ÿ‘/øîŠx÷Î
c¿µ5aÑÛÉâBÊ½ùÇYÔ]Ö[ÍÊ.¼…Ñ&Aš"5I˜ı¯ã{|y4á^/Ù„ñØ×åeÚdÒ>[LÚ‡ø6Ü†|ã÷*åÊîüí…®Gî‡lïBã„DÔ`‰‰i˜;ä¼ºß*Ä#«ŒÂ&ÁÎÃywF]Ÿ„¦#lıÊÚ)2Šø¹w£°FÆÿÉéÄÌŒmĞ°ÚµõgõóTç>‰U JÕP£Y·?•¸G¯N=M,èë¦>aIıî†mõ:\½{åp/14™V5ü®…yír!:ıQ›´Ç…B¡JKÑë|Ï…nZ>²Mi–)å·lŠ¼9Íı¹ıË>´§üfÃ–Xû`ÛLå4ñ-”«Î¢2Ÿ‹Ëz¹ÁËÍ¦ :ÕM·mæÚæ]ÓˆV^3‰J¦õñZ¿Jk)½O„¯Âfúø6gÁk'°¤t‹g/ÓOÏßÛ0~;ÅÚÿí•lºº‹_ö[ŠÿéYbıâÀº]P+§ê3…„"»	¯õì
M®µ.0ém£–è¨Í|¢~x§pƒ|˜õHHEv½×XePşÔ[Ø¬2ê$€S¹Õ ÄŸÔ
õq¯ ¢D%ßÈ;K[5^#ÂÑ€-*27aêYÉ¨)»[*Uí/øg{g`¸c?HÕZ¦ülÜĞDy'„ÏsÅ¡Ò{eKıòSêûÛ-?UÙıÂÿâŠk7P³O	àÑ S$ûÅNÎ£MŠ¥;‚‹¾ÚÌ…’O ¸Ôõ¯}Pü©/â¾ë©Ä
Š\ApƒG¾ØÁ}Ëq·QŒgnØÕ!
©†’-ë	…B‡¶>ü•iNH7¡$§ÑNyÿÎZõˆ^Q'Ğ‚ñG”L¥L6äŒ.ïO±®Ixè¤ä%:¥+«U:ú÷6lúûõ~nV€t¼×®.pP ÆGÑÊì.?÷b¼$’x±ÓüjvIŠ.ÄĞ‡¯ó‹ÆN&¬øËI·Óy©Õ4\Ótí|İÎ„„ü¼?ñpÛGø0}¿ë…ÜT¼ø¦m…ä„‹’¿Øo¨­57Ã5R€#ÔX¢kËKL‚y%É:Ò·Ô´Í­!ş9Ã¯\„‰aŞ1¦¹ŒÛè‰LûõS*¬K (ï
c¬×(„0
TzÃÅL*Üó	·Æ«nNìjM(u]Í¶­Á¶WAc£¡ÿ¸"E´ÔMw³Ì¢¿ÑÑÏ½ÕÚAÌ0ñi+€<‚D²ÿŞuä‚?$u£û™Mß™?:—
/ş?×¼¡ËâkáDP3Ô³àÍ28ä-8ßÓÒ*™zÅW2P•3©o0Dô€Ô©Ëº{ˆpãD(D—«ëpVÚbjc.½êÆ”ÃC6„-(¹­É¨BÊ«*€ŒÆ(~b	¦dipRN?ÚN ³HÆ™0Üú6?Àêà¤†¾Yõä‚m2…nJ	?—®¾ìô¦¯O¯ÍHÔxŞ°)ÇE>éBJ¥#†MÜNŠïIOŞÚH–éÇ`=·§tJ^ı÷@m‚¼™šÛü<ó ‹Ó X¦½øÉÅpâLJ÷Ô–§Î¯;©5¦£ôÜdğÜÓÕ£»yl:Õß×ó°Ê6°i~ŠÖ¢0;ïN[6öE„€ÇšÒPZŞó¡h/i+Ëñø%P¸ Ë<÷[˜ª›K¼^Ô§˜)»/t¤uŸ†|­£Úv_Å5%D¨ÃÃx.tÉüº[í>sõDär,„‹ã´ş²¨¼âvP±H<ôP¢.¬lËoOÚáJ{p%…ïN.ŞÓê*¨bcLaÑ`jùôæd‰í On:Şº¤:O‘¹ °\ƒÌB°õ)ÒŸâ­ñ­(æ -Ø:;•"}ı£Z1KÅ7Ò…®Îc‹Â‘mó÷‚]ËiP‹:›Î‘1—B+cÕOô“l:Á
pNB±/°•/{
‘é'¯¢Ušê‹Ğ!om”§˜æ#´H‚¤… “GãÄ'SGËĞå^ê›»~z©Ûd>5~÷Š‡: ×pjGrmo¤Ë‘ïiÉ2ÄœÍríö­—ßß.Ë}M°“¡è’¤Tzd¼pfí/Œz'zÎûVVî´Ñªz
M‘ºrâ4~ƒ'2Ñcô5¦Šû‡F»‰ºLßÃÂÉš²ºªÊ†
%æ/ëaiqÚeW±<oì68i`>ÓéUîüä‚èìFàXÔÅ5+€«ë%=rõç!!„˜ÑÇİ ä•¤kß+a4²ET4ô¸?ôövÛàö>Šó‰³­²Jo7m¾w‚	=Øµ0hKÈ²ĞÛ’È:•QY)EYÏ™t.ëlcN(ñúâ¿8Æ‘öú{êıšlÀ°ÅĞ|; Q[`×š¤]µÈ¶8r]/b·kÿ<AÆ—×‚¥³VÚ/Mw÷…Qeövq™beÏhÔæ¶è(Ñr>(ö¢8 âj§Ôı;%0¾ï»pQªí¶‹.èk‡‡‰ÌKv1öŞgí‰so’(1Y©ÄÜÂâ¨¬+U±$‘æsÍõ2¼MEâØÉáL>¦`ƒvĞx%`rz£l‡ø2#ÚtRQ0	O	FëÃcm¥ëHÈD.Mí~©“w?ãO(L0˜•éõ›»8§Y«ŞNZyfî"­/izøøõ¯áVí%­dXğ©‘dÏSİ¬İH	¿?Ú®“‡©•1Ï¸ÕU
ñv!öúÍb¶jªlŞ4J-£XºËâèÔÈkĞØáL© RVÉØKÊŠ$Š%0qúìH/À¬Z”\RAŸj…"lûi¯y¿Ï'â):úQe½³uˆıÌã`EŸò¸Fƒ%\ûõo¢X£y0§sá›Gî¸yŸD˜t§)ëô‘|»Bv¿,Ç·oÉØŸ]ÖÁ÷CNI%#O‹è½áôô:*U;¤øã#Ñí‰O7îÚŞŸû¯.CãXù¥îÎÀĞ}úªa¦Ğ#¹äñp¿e%à:xæe0»LÏøLòÊZ°’2'OãŸCêÉy‰³Ğl¹¯©lj§ÔÄ^ˆËW¿‘qæ*š xYvŒ+ıÁ^‚Û¿¡©!d·k*pé	M]!< *úUç44™`ÆW¦ˆzdL	ÖÍÚşk…/ê‚	Q#ËaË oı&©¼œL&ÒûÏwÄïâÅfĞ•Î€RFu‰®|G~Yp8ÑñÄ1|MBbÚyû|0ó9L¢Éî1mb×~ÕjƒÜÂÒğA[s—’Ÿ°nø]P½B©÷r2Üò\Y=ø+%Å;şàõRË‹)ÓœPJi)ÂŞ±ÅüãnAdê	?\éQØ=l/uõ,"ÎAÔú}q2jäµ‘“íğÜÅWOÆ¬êªJŒÌ|ñSSo¸ ãæÒÙóv7á\à$°Ùi”²?[]L_İÍ5hPnààR\5Ê¶o­d‚¿ßmEóÁ³®úê%(9J2£‰ÿ6€Ëğ„”6<³¦¬Ë+¦|ÑÁl&©ğÕéÀßú…ÔÙì{rQVnìã·wŞ<Qåñè*ØÑ[š5²ıoK¥x¶”îÇo5OùCO¥†İ×Ó‹C0
i‡=Q¥|D˜A—áİx&Ê‚¿:U1¬°[÷êÃA¤3¦ylêvìPßXŠ¸}Wì:BŒı¬­—j!™‹£‰K#†„‰ H¹Km‡ğ]½o[ÄF=YÕztºg2›çş‰è¼µØéd%Gò.Ó½Æ @xè§ç˜QPCLcK×åÄ?Ÿ7zª¡C;z{ãšú~ÔM#ÃØ»=©.Ë¤ÙÑÈîÇ[ëÈ×BşŞl"Œ…¼;QR¾&Ás´ÿİ8_«J$äİ€Ùê0d]jGNºf/!ö,¥©íë&³éßŠ.û~Û(õÜÑ²eÂÜzúIY÷ÉQ
²ó(	·*9¶h#®|«×È»êğå]YV.¸æ‹{{‘ğgñ|rÚÅÓBæ“ÌõÃo¤ë‚í•§#±}Ë~j‚‘WèÅhFBÕ%p°Ÿçß˜´ô/Úg=¸¾„÷ægjÏtÚx^.¨'¸V)”È1òá(œâßhy‚ouÀ$^½İjÎ/˜u´¨ÑÊéÊ"µ•˜¸,+›P4vÀú¢Ö\óøvu
‘ƒmì®;íafÚjMD¤D¹Ãt·#YïQ‚£(ÌÂsnùWæ„­öµ›Ó°ç–Ô0¼ë"j şûš~øÉ]Ôû¹~­~Íî†°»²êkG•öj¦UÂótº\tĞ‘İN&sİM ×:ôV&¯@B­qùæ¼qE®Äv_kğ5²_ÑÄ>(6âô…ªØ{ş	±W¾ bº$ëê“Ãû„óêC´²}ĞäXÊ8T~‰;Kü~>æÃÜqu«LˆŠOïaª‘T´O@ı~Î§<öDŒğ2t´gòŒøxˆÍNrk·aù•Dìq 7Á	Á«ÀR“!¤¶á¢,fP¸¡è”ì‚Oz“à›œ)èNj~èƒıMdrñnÆ EAsêëG!“p·(åOŠ"L¤?0k…­,H±MÂR“Ô$ïc™ÅÄš7nÿ‹ìñ*Æ¸U{¢²!ü Â}ì»MRJÖ<üN~LÇ•|U™Uõ–ÿ¹PD‰ç‹…Àh;@0Û~•|UC2máÊVg8wí•ÿ©hiÍ‡¼L¦Qƒ*Lƒ£Ìó×O.Æ3Êº¹|©¶åÇzˆyõ¢ª,£\üIìÖe§=UxTá<zÀ>³ì×°té`4ôw`¹sèÈøö_rñ"¶N	Ş8‰u

½¹F³û¶éz,ÛàTÊ×ñ[oÚ7NSé™”s±ä*dá5<r+·-ÈîigÙù„9ĞÙ\%pı­Eü ¬`såz(kñERçû)²ê’›lÛ—KùL¥o	&t×UHvyèW‰@W¿,n	šùÚV*­áV­§|#ZAZëvXó÷.*½‹Ş«¥–q„° HVÿ5Ô}à@>š° BÄb«GÀ
4vÜ—ôÜ^Â¼Hf-()FT×®TU‹YJĞÓ´çö¢°;Ô;Ê¸8—õE(şá‚	ıÂN«‡¼pÚ4!û«VU$t5–©ŞÈ\ŒìO %¬=¹iÃXÿùŸw¨*áãw–†wÎÅ•cŒ% !FŞn,|Úô4Q¾û&ÕßüõÂ*ds‰@n‹ö‹87]"ÛUs¦‡QïşäÓù+	¸“ñ–®H˜¨GTIò¤Ê·–´˜Œìï‚mH-ïƒÍ‚†K?ïØnÃ;„ÿç÷=½ï+KÛW‹³s›Õ‡5 N+@ÅêØ«T¸«¬KËºnîÃã²ää¡JtËy‚kE™A|ÌÇÉ.—j#'Çî©¥sÌüØùÌv³U¥ù}æØ=Ghã;;fö
ÏAÆšõ éºĞdr²Ö*–úd&å\ïEo«¨qL{±£–X«qS?z*³‹Î¥R·2û¡Ç;hÈ“.üÎâ¥få±·Å ê¥¿Š§ºvãò40bÕåıUêŸòW<N‚½R>FÜ2´ß“Gå/¯äËı5–g©4AÖì;Æ´ò,äTêîÙ§(ª½qM.ÅJ‹\bn•ÿ'mot¨µİØZRúî´æß¨h½¦ UPm˜1©ÂÙ@õeãILxm»¨“ğ¥¥×3ÆSEÇÄ+k ¯ÍıGš/{lO÷D7Á€Á¶ŸÉâv€hä|©4³‡1$½®|¡Ö
Ôzz!
#”óe`¿ÊÍî5?f²ÈíÆ&‰'¶İù¥çôÇ•ç¤zwm–„ÿkâu‹[µŞ¯ˆBe<H”øÏ©bXôö åÂ/ÉŒ"©jë¥ÌŸLZ­4Ö:%áÙİ\ß¯m@Ó3å¥ {Ìx»¹ÆÇvôş{Ááuù…yûBö°ÍÃŠHµö	ÒŞ¼:Z#Ò¶µÕßS¶Z^†(Ø£X&²÷UU…™Ü4(ªC²%ÆŠ%.[ÃïªßGdÚõº¶©VÖ_p@ˆÃÈÃĞ­À˜-—K™5LªaÒª™ä,)lU2¹âû ¼‹%;«~ZjâC‰4Ü	1€Á ï+4V-n<Áÿî 	Á8¼LÓß'²uªtœ|ÄK48ŸUîFì×í®q%lø=wh²á²ç"ºÇ]ÉSòhâôÑE …¢Wra—Šøn‚‡è%Ê§ÀS…:×ÎÍiyÕ'õ´`® íyIäf~*ŸMÇ/vyùE«:âõÇÜ³5µÇ™¯_ïüíçs³{dXäGæÂu`çÌâSYÛÔM¼à1SCÂó“ØÜ¯€,5ù&[«íx™‘¾.®8Š‚=`öî2¤²Ú®¼—Øæo>±L¤2°ÄLksâ>h•”´&¿ºõU%6MÌŞaåÕP0’¨‡rsw}áÖã”rø¦ÔÆPƒ	.¦÷S>pÇªO6± b $+¦ÈúÃ’UÑ/ŞB¢8$m1ÓZÇmOÀ7eàqQâ²ªÍ­¹È^¢(hÿÄ¦©‹¼L„şœ@!¹…-¼ËG1~	Şn á¿ˆM­,Éÿ.§á´[“ƒ?ûããÅ¶ÜÙzLå	Œ‰}@F8áx¥SY#¡°%1ñ©é¹°™"ˆÌ‡F\ıqE7ìHOğõ‡eøWÁ‡;ƒë/S§‘– ¦£qxÎñt~¯;ù”p\×²XxNÚo›5Ö	Ï&`(P[~ƒŸ»lŒ„vÇ´spô<b‡ áP§Ö"îÏ"â1ÒEÌr!,ê1”
Nº =ËÇĞ[µ14AlÈv­işsêŞ3ãl"ƒèïhT2”®Æ`ÜvF”¿ƒÃÃĞm<Føh32Å‡í0¶ê™Åùóg/â™‹ÑêÑw•nE‡•??q¥?¸Îğå‚ßÙ	]tôÆyò&+
«Ú!Ì/W#·÷›”ÓC²#Î}Ò†!v*t1¸Â½X˜VÕ˜öl‰xP…úpéìÙÚd¹BKfTKË“Ø¤ÈŒªİÛnıîÄ9$Lµdj&v7ä`¶]4—tZ5PÛB`õ&(p­5¯M”Ğ@ª½xKÑÈ5Î5‚DDmŠ¦Øu8n²‡IvÊŸÈ§3Sq_çõ‰^Œ6“_’ì™ãğÉ|ÆktvdÑ>ºø=öv Ÿµä“|ñÌ×€ªZµ·hëVR#çî
I*å9?°E©D£)$@Í6pÏÓ#_r¿Nì@·Í½>õ¥•èn<Ï+µÀEM¦ş-†Kõ²äÌ^Æ°ÀN,Ä-Hı».>H/âÓÔ•Š¬'Q7™ôM	ªñ¥nü‰JHnwÎÿıÆ½‚ÌEMö}­Æß¼¥‰¹úó…_ô9an»­ÅTéÖ§ »ŒåºŞ'í†/D­”cÁA¥hÁû³î²ÄKw»¦dKù] î>€Ì7/×y
Ûw÷šK
p2w­Û<£s¯$ĞÚğ³…®O•Óé|­<½ø.Å.Æ|¥U:æJìÑîvZ­ì¬‚áÈL2?9 sHÁv·ÁØz@lÃ¥zò!‚Ü!q]¢Èğöš|%X!åşjT2ü÷“˜üx
Æ¦ĞˆF):q”ïîINÉ ,Üß¡‡zŞ“IÆÿFÎşD|6òÓ÷¨®,?Mè ÂD¸ÊzÔ ‡–‰É­ÌnŞ(fõu¯[§ôã¶gmıâ2 aÑ¤•Ë‚[nş)æ§/¾Ğ~3ƒ÷î"2ì‘(ş…a>PôC§ï¿Yº3×W;·åÁsèÇS‹ˆ]&Š1ÜU‡±.YFX“C>Âe¨ÅÎsL@Z)°"8DjIE [¸W7{„ˆçøvô<ú‡aØ )
_ŞªédÑWˆo:w³8œ
$&ô6{h¡;1¤Àu;O˜†5m\oBqÓøa!œ{Á’Ï‘Ÿ"°Y©Îí†“ˆîƒ{´.'H{6í±ÅÇE	nŠÍ€ç…áıJu}À€±‚ M6JjÈÇNÊìu›2®ò°üÚ&…Ns<“ÅÛôĞ¹J÷tö”a%ğlÙ?Èu j8Ö(_d8¾5T¤ÂáÓ:3=_B)qqVj÷{›V9J#˜vÉí4e„ü¸ñš×)vÄ@ˆb¢XPAj 9Ÿ,µq·Ç<Õ)2ïè'ôqİä7A³ÌL'3°®ê 7Hªr0 )I-.ĞÛ¹À ‘jäSI3f!&‹>I­»i¸.‚ßi¥iŠË~¯‚rªş|r]c¿.I€ĞxH'¢í‰¾lò72{¯¯‚|I[Ÿ6víûÙÇ->¸5ÈÜÈê«ªˆâÓîÀ~lGÔŸ’Í
²D¬ÉÀ­ô‘3óá…¨şôĞ;t¸Û\R‚LËûvá«º>	áµ (@s`8ßBK]’Dÿ­É=Ñ ÍÙÖ á…²HŸsTw5ºDì›Ä5n‘ÓmoÒ¸S¬°4Æ8ûs´}×,ce'4Wlÿ[i¾kDëÙöè-ğ3İÈAN™Ú+ñTNr+àÅîÿ²ĞšxiE¡­å/l„†üT²ŠÉ$ éBP´Ãå‹BŠ À/Ìı»Ã÷B[à_s'QÎø7Eàùò†I4‰ğv-èÔ!’Hw‘-\o’8SÒ¬ÊêØB„1Eø@'­*¤ª6ñk0´•î¢>`“ƒE* ïz^4Öª»*¨îS
u~MI´YØFœHà¸EşKŸBÃt¦v>©`“úüÈ‹Ÿœ&Væ½—}Iåşİ^Ç*tïÉ£*…–ù¤ºWw7É#5Tˆq9êm.JcS·Öî¯E¸-”ëÁ€ÇîS„×pd]ÑçæŞoŞöw! øÁ+7ØY°=¤î" ;©À7g7SåÀ \I£q;S‘½W±Œô4_¡ü—}q</œP=™0é/<À»å"ôİE ¡¤üÇiÕc#$>u"+eŒDû¡rÆyf9ÚQÈÂÇ”€í3ÚPÂ¼ğåÙBÔz?&ËÁûŸ ó¤ˆ¸òº •ó€ÇÁlKElwş-h~&,•sïFØiñ~¸t
6ƒ­{83äéKÔÉóè8óÃ¦I²Â±Oú^eÜ¨¯=?8q¶9iDv»Ğæ¼?$à“ÿJ]G¹0&ÀãĞ)«có,ŸïZø+éoá.q¢„r=¥‡XûÌu)i£Øzƒäì„¢J?ş·¯†-Û¼²—Æ³Ø£9§‰rŸ´¬xÎJûˆ<6J™ç\q!ù2ĞŸà iz@´S;Nw[N²¨6†%Çš«;â†Tğˆ#¬ò÷†£Z”Zµ`Œa6uHÿ·‰ü…;ÿÔ¬Dº3ßé|R“¼ÁŸšîâ7U&Ìmh;zÿ.¡û¹P5xA-£˜*cX·„÷®ß/ÎÚ_Ş/"²H^9e· ÁY}Ä²  ø„œõ>o<ğÏí¨ßFÿM÷9‘°L,Ñ¦ª²S”©!eù´È#o%ç"‰•ºm¡ÃùğßQ%,*Ø•n ‚õÁó"B„¹·o}¡ëA|ØU´ÿùå¸NÕ¾!‚6Ú{.<61™P·Í(3`U1¢¼ùßQ:êù®<¥í{Ôò¾†m‘™xrx¼èo¶àğá¼â™'ñRJR0i°µ¥œ”£	 £y—ütÇ9éÛ)º·°î7"÷“ûO²9·¢­œËî<)Õ³{%øö4^ì6‘+9Âû§V=c¹<‘`ˆÀ|E‰êb;U` Ùh4ó0‘è1•’r—\=Qõ¢‡lÒ qü®¸ta¹WÉâdäŒ}7—ı=¦›Nß}Ê}K!pn®¢/»Ó'5±–©"qC¨Ş×†ì«ÄÑÕÈƒ™Êöœqş©`ğ×•h©(øõÀĞàı§5İt„Cƒé³Jtuè§`â(•™3Ÿê.a‘ÈîSËe(ešX¨ì5!OM6ØHƒIx¶æ[g›éÓD°•mÉû¡;•%3¿ç é>˜KÃx)>ÖqXŸ¢àÚp
7"é»ŠØ‰ä,¡(cíÎo!…yÈO4úc;YÛ?ğÈôY§y‚rÇd\şönwıÊ@ä<ï:1‹’ñ•+]ëH¥Öõ~Î…q[<×®h3)—øDmg¥2j WñàÍÇˆ3ìÅZmz6Ø@rXêí&Í¼±„ÔjÇ‡$'ûÀÈÜw;
§J¾²s‚lÃ†M¯¨‰yHbÌG’/Îÿë?îjŞ˜ÎñÃE¡Å2T__Õ:V¨ê‹ÿ¾íÁÿúvã?dn~ÊÚCîi-ÕIåtÃèoòâ2'"²º1V¼+º¥/kíğJärq{İ¦»€ú?©Àß™õu&­˜ ı'6XÛ7ø€kîï»dÎeT$ná•ám¨j¢G©Aº£8¨ÌN¤ÏG‚x(›—WÆ˜ê F”tÙL¶Ê´Œ³ìİÊ£¯ÎÆ,¹N¸aÚzOX˜pöAr-öÛõ #¤¿”€,¯›ù”—Ó…'(Æ’ª‰kx¤¯i@¸è’¿L4F»«"ÿ¦2|wAdÜ³2ú/‚ô–7ßùã´š¢§xŸ¯Æ=•õ¯YûG²ƒµD«š<ùr©D_+nÃ5)DÀsj²ãM{7tÒ|Âõ-PÿÔªbLéZŞÙ˜Uş;9Le5.üæ@f05áXÀÁÁ…´ŒS’bùŞC!hõ ÁiiQÿòØã'•~ªuBsc©ˆœ`ÂQ–uä%JÅ=|¾“4µ½¿ĞkŒ,³îóÛ»½ã1ÛÏ¹˜Ä
ÿwu @eG	ş$h5
qºôÎB²ó—ZÛ©ÎğƒŞÄÑ²›sÀ”o~QêVÌ­£ 96‚…ø±â„b‰ALJe3Ş]÷jXÓjÀTœÒÇ”rŠ0%3à›:ğSa>]ã‰~_“9‘ãúøÅ-*ê`·˜»Æ+êÜRs«ÂIyDì(MŠì»Ü0ÈM?·d÷Ïq:Œ
Kå5vÎca|Râøã]lİ=®&Ôù3ÌGi,6Cµ!‚6O”yîS¯&Ëh4¶‘èn>u‘½^åáâjZÎRÒÁú43éÆ3´GNmXÙ[ïœ>óS÷ø³¨İ<ª@ÎåºÄW™°ëïıaÒ‚oıX{5T•øò”[p3si-.—®3ÕêoÿZRªgì"É¿Uu™á:¾²rjD)Ë±òLóÉqDßjL3DH›“åIpìo—ôıíæTN@´ù7áõÑ`™?ĞûuÂ0&8m‰t¹-Rf¾Uö~ãaNÎŸ@çñšJ™ø€fY'ƒ‹Q€Ğ—â4ÄFãAÊ„öŞVŸnáœŠó²HÆ.ã2s½O*ĞåW÷T‰Í;d]^òÈ>&]|˜¾Üà´ÊÀ<š¿÷ÛÌAG¥dı$ë&Š@<EÒBKO/{³l¶rûkxRNC`.jIZÔlÎ;½jŠb†6ªÈÎYc%L­ûÇÍÀ(çÍ%§ê~©*ß%„&Iæ6îr¢MÁÈ‚(§~è6ˆgÃİø¨¥Ùgä© wYf‹h4}¨n6·¡-F³ú8Qm‘Ô´Ìv¨Ö×åSºÙÍ06"áZöØq·t¥º™$2ô:L×ìFÇHÉtDh§éeìkå4aµ^áMñæÜüĞævås‰,ÈÀ±Ó†€	F/LÍï<YµÃN]†¶şeĞ§·‚ë«*'×ä¥Xë _õ±ê¬Åºˆ|k»Äôêı2°×µĞwĞ‰y}jä–Õ4Òà©]ÔiÑ€ô"’ ß\Ş¥éFé0Xpyƒä~°à#üŸ¯E2ˆìß'°úî³µß¼ÀÓœp~´O7D§`³[*é6e**¼aS£«eG™Ò/_—=;ªC'–¾v°¿ğ«<G£+,~iMJ‡bÏKa1x!*G™ô`6»Dúé·ğ—!ö,Ñ¡‡Š›ç¦d_`«ÔPdŞ­ß`QıRÀ£#¾{ [óÿ@'lòkº ë‘íºß¿3ı`xI.e’—BıIÈFŒ§h1ÔuÄ”4Éú”5ƒ'Zõşæş4é £€oıJy)Zi¯÷‡KKt‰k6Ş·Fj>ï®‡®–—;'{Ç=unÀãÒÑäX«\Xq”!`ó·-µ}ÂêÚº¼ç5`ğíŒ!qÁğ¯Ïb(¨C`bb•• – ÷nÚVQ´3rbï­ îêòÿE›±ëñFã–"6Òœ÷§ešÇıª¼7î12îÒ…!Æıoy´»Û8lÉ'35Ê´Ò5#4çZGÒ˜pÒyæ¿1SC7ĞÜâååHÖ CJä,lå‘·"IİæRDÛ"ŒY©ƒwGãV0
/rVD‚{EùA«y½NŠ.V‚²ì8K«CÑùä¸{[5<îNª&İi£‡–oÚœÒ°K åù¡H/’ğ ÇYÛ¤ËKşN.$ƒ¯ì­?ÖÔçÃœ÷5¦3Î&Šõ‘¦,Jh¾×åÜù;ñ»†Š#½9‘rˆö¢€Zù×ÅC@{ Äö//mn[¹kî¥“7B‚|zTCÒHªûæqº1ıJOl–ÿ(~ıÀ0j†8ªá¬	N&Ç|ÆáfBÂåI‘omŞ¹üMy]¿JÙ½4ÂØ$’]”SxóXÕ|ı•Ö¯®İ›4ùî½iÒí)ÓëÇĞdynğ3	¶d!w[®2sİCágƒ1r†®ŒHò‰Qºm¢ú1½ NM9w¨i3Ã£õV4ñ¼s†D‡˜ ½7——-»Vìß¦°7ş¡=C£›Z:¯ÖôjFT´nŠo‚İeD›î6?&
•’Ôš‘lö÷…$‡p=&dfı`ø–$—BõWi>?‹ğ™´sÏUö'Ÿä6o¥èWl|•†ÉÏÕêåØ6xîÊ¢|dÇÏ½†©;¾YôÈÚ®æô†ï½Š,Á­¨!keTnrÓã•,k›àï“Ğn]°L4NSŒÛÕ€09 Öó/…HF´ö%üıøIãÌaÑP»­pZç?¯ŠGK–²Ï¡­øxÏœ£Äú5<†ÙìÏº“Iè(Uê' | JuÀöH|0ş›ê•=ÚœÃ}(´?·÷ÔŠ%Nü4jĞÊn¿Ä­4Şƒh<¬Şô&Ì/´R»cK$šOYJÌà‰Šs}/i§­µöC«¯PssSCr=Pè–r»ˆ1ıĞÑèi7»Œ™Šy%jcúüÀ¹ÿJ½ê`î~ˆg2T |†c üØ¿<õæNh´•}Mx®¬w×çŸTæ„½?-:c1ëWû¥´ÊyBñ7=¢G¸Ø-‡#t¢2c¡VÃ_aR£l
¸3îGqÚÁz’ÈŒVº¿"Ç„_‘GÏ¸yù¶pãåq[ß¸¦N£e‘ Ğ;ºyí¹Us¾(xv	ÿMãY`ØTr/9h«òOe‹™ÿËå¨§¡‡HîÑÑyù,5œ&j¶=šÿg¿ü‚n‘éÆ>_ÚàæcôI­	ÈqfÄZâÍİß'`!Áéœ£  ]Ì‡ãXÛ°ÚH¥WÉËJójşÁàÊSË·'’ƒ,á~„x
pq-8iZÀ0-âÄ-aÍaú$?î˜ÄõNr.ğÈˆ›½›ÎS(-«×Êá/\t+3P…J.”NX{UÈxŞ Ç[t2Í™Ÿ¤ğXÒ’áÅÈÍ9ŒjÈ£äæQŠ³	Ğ 8;µ:ŠàÊéWómİYKM	IƒêæüÜ?Û†¡X¬ÍäOfÍg;œìäéåhû¶s¢i°Pˆ³ÍÅU<£á‚±«¥/À&SÙü¯ûq52’”)Ÿ¤ëEÒ&Ômz6–ÿ.‰ª)şgéK7‹ñÊ‰ª%¿1‘pQp²gD%şk3_ô¢+³ğêSÚ„‚7Ğ¥ÇúO‘“à s¥C7›7‡`™ü8\qŞc\]Ä7"º¸g=8-ö {äÈ7ºêÈ:`«z†»a]ˆ(ÛÜ½&|ƒG`[Úñ‡|HèÁmqGC|Çº8Îø¹œ™Z€5äYÃu©XoQ“­XÍ,7àÃÔò€¸‡Ş-¦¡ÍğË+®Jñı¦A€öP}+ÂTlkú.f4|'Î/ v»¢28@ñ%x4ˆIº5&9k7¬ôªlñ˜‚,¤À•gù`5¨ø6NoW¥€%º¼\-j·5Ss+©ºN
P´İÖsÂ–[C 4G`ÕñÊô;ëSúmM»şdåTS"v2?Ff.H8z3ŸLuZóÉpñz»3mÃW¬6K®Ñ¬íw0ÜIoµ¬…É‰ƒ³Á±<s"%ÁŸG#šIC×(bu©GBòpâ’*³ŞâTrzrßä]|-“™„#¼ ½ vP¹¼ı£‚K¾ˆä|oÿiªİáTˆûŸd‘g	§ºLóKÕuqØŸÂ¨©L±æĞHRŒRJçd;tW_wÒuh‹aZÑşÓÚ£:‘
elT½$Fb ˆ7Vº&äø,i&÷æ.4¤çb–ş€‘]À HùCr&ß¼¤¤HpeÛ¿UJ'|s»ü±¨ûËBèq@*Ò€Ü|ÒdÛéTu§u©]eğ‰2y=Ò‡èwÉ²€B.Şñ Æ¯p°Ùv¢ĞßdØ‹Ş_qÛ«¨:–„ÿò%…rsT5ÕKÎÔìN1§ß‚—.¹	kN5‡ÉAéÍ­ª¿Cmœ1)' Ê â±"Ü6Ù> å5ÇwsŸ/9&aú@‚•©hã„LuĞøOèœá°½?^¼ñOò<kTK$Ø«š)aº8nØ×Ã4\«ˆ5ç´ ÂÚÏW	BùÄç_ —eóå™Øü«àE§ªji¹kámĞb…³(ÅŠ ‚úypı±½Ë³©YÙwüs•/ØMEÈU}œšÑÊè “Õ“^Ğ€ÿK½•­şçöA_XÕã‡¾ß¥ıGøŞù Ço`ŠÕQªïË¯¡ØÑm:ë"¯}öÄ¤1ÕàA€Hà¥—ç„ÓjV ‚/ú,Õ¹+¤3«„ôr^·èÙ-L´¦¾ºî-¦5¦¢&/	Ú0·{ş¶Ú »6©”[9aò•„Ş1/Ì‹µ@-OÑ;)4¦pBÒGbe¨û½¸hE¼KŞéÓG%Ç=fß*hËóÅ ÇA†sùŞÒÂ[Æ&EÅ´WväõİXÿª,V×†™··œî”	°üÔ¶!·¨V‹VäÊ ùÙ×’Ë•ÃB»[ªtÚªå¡ö?m³P 5ÕteëxåqĞ‘F1å³ÊZ·Ê*
@8»m‚o˜. r¨!ö÷¨Äs!'–>¸ä¹‰áqş‘•iCÁiP£¦Ò²ªE·ïdíúî¾u‡Xû_ Xvãæú9šÔæ“Üs3¯™ü `aÖI-rzîÍPŞËR99m¢€±1YI÷Ò³†äÌñ$g”.ÚJˆwKÄõBŒuDÔŠª€ÖV£Uì@Òû¤Ss
Ê‹;ÔımõB@ŸSUøáNÍÚÎX'  ñ‚³em®õ¤W4óÕ=£ÌÒêõd.M$}¼Ğ£ÂıVA½Ï-ßÌY¯~|øÆ šôİXˆ íäMà’õÉb×uD(¸ävOàªùØ‰€ÌL{RuÇ¸ˆ^˜¨+>GmAF¾©{c%Yq¨®‰	‹NWE M>”QáÔĞ±ƒ–fIA´…hŞN_ú¼9¹Ùj¿U›§'»B@0¸ÁŸm•šÓ´~©â´€uZ¸EO:X?^UáĞ+òÄğxË¦›™ìy C’Ûf™µDF\qÁ6Ûß+?®ùã.KCzC[á ¨Y’DFKÛGr+qšÙ“I	ïó‡ìê_j…º”ÈÂ?·g—ªÙë[˜Òuûúô¼’PÓ­¾Ñ!$ïB®™¨lişŸx=pr4õ$µoÏéaMüï×„¾×ö™ş^—æÏ«9ìÖhÂJ§Óå%j#oç5-¢òœÖ|¨æy´ĞâH¾xæxüWÛû^N=ı[Q3B H9úÙa-¯·L¬ĞñË1&®N^!ÓmEñ@”{B˜XN¼F—b¥‹1õ½ˆ«|/Œ SÚa$ˆóÛ)ûëÀØ9í”‘Ïw u2Éşşìf„âÅ<»Pƒ¼\ˆc¡Şãíìáäf3Ûo¬}+ƒ?ï‘p¢ıÇ´ËüÚ%	,w†H?ñ~¼3M¿xœ¸LÀÙtoV]­İ¨fIöá÷Ëìş23Rí¶Úƒ§Û]AÜrÌj–*ªˆ50_\T“¿úĞä+ˆÒ!Bø »ön×3_¤È-¼§rD^Á7”ÃYsñ§ÓÛÚ ŠÈ„ ¿ÖÂ3¯Ø›=¸!³½][åÉZëh‚,n-ª•ÎÛ)Zntj]™Ây+`ìÊòş°xjVZâõÁíJö‡=~-e˜ãŠİ´	ïŞPımcç2àŞ•I4Î·šÖè¬nC	àşŒ¤™%–fT"å[iÊb;ÈŠcÏ8&µK ²ÚØ1)À^¨­>íLw ûg°2ˆpŞØ:&z¢5x@×¨
Çh—2ÚH—JIê>ë"Ã¡ä¼³L›û&’¸c+ÎÌ®¯Œlï%@zÃ§%Ü tØŠ;Wfƒı,xG“BI]Å$©'ŒC êxˆ67ı‘ÉÁ/¸$Õ§Dë°“½­½ÊùÏ¿İ[Û§;e¿Ø¡igD]pªÍF IX³9­EMäàûã#›bØÁÇÄõ€Î«9P\àCëíÅ{z™ú´ì›¶Rû·Ùh†6ÛÎËÊìÃO³Í`»D±$oj“og'šxâUü°¬ş.`O:Ã›¥ØÙÖM³Ç”È›Pê-fòŠO–Œªépÿ™y’KK­•ÿ®–ş¶¡æ‹¯„¿Ÿö‚²±ª%©¾eO[»QÃiQÆ¾¶b„&Î8n!ÔœRpç¶H=¡Ã{­Í»°³ŒråµÆıš2ªĞXú:0u1Nm°]úL÷AølçŠ€*…Š³*ª.Ç½Ë¿VßC4ÿò!^Ì‡%.¬ïçæ¹ƒ¸8ƒ›‘½¶RlL2”ß°0XÂã®¤#@:¼lUu—lp.‚¯˜z,1ò'÷Åu¨·	-EÙ¤ByŸ{…êl ş>a·Î¨ÚÎ}êILiòCäa.z««dØr<Ú4
}quÓ*XúÚÜZ§BM'ŒĞ.9UlÁ»
:ôœP?jŒ{-±G+U‹&_>½û%¹R”	~Ğ›>#òzû_f+2MËlD_
€¿šVtEñQ^+JõN‚JÀÍµƒrST¶^UT‰3©–7’±¾™.t- 	ıHïQù¡Y•&—‡]t»¯f
Â7[ß’4$pØÉ!Ÿ<ˆÈ«*x»Ğb§w:ğéÜmNU2œy¯[ßW7%ÚauìÎ~ëT½Óïü«âSsÕÎœl ï<«†šuO2Ÿ:•WYMIM&‹Üe¦2%î	Q¢#2UhiêW¥À6«Dİ¦tš7DÁç9…ï‚‰SJ=ößúÎ~Yp0Ï©U˜-Z+Nƒ>¥©07Pö°>ÒÁ,¯¹)1µD4MåDuòãSPê Ëµd7 §ÿJÌ0£ò6X«òh^–kìãoáUpå‚·ì1Yµûİ·Î¯Æ¾ÅÚåıZs‡Ø	['õe`0%{şÍ]·ÔK>•D«‚»Ò÷©ÖœäÇ<!Èv$b×³T9şø—+•¸ç#I¥±|‡Ğ‡êÌ.ZÂ¹÷ftó¤ñ—Œª¦JÅäôÁç†mœ‹¡¿Û××Ó¾“v¡Úf›—)ïz‘˜üI IúúúZ‰–~¢‹S™ıO1_{ÒTt$n 5–³üÂ¹T½Âİåœß'Ø@¯<¿^³]İÿXÙç† ™?bµ«)¶îÛÜk²ŞôåÃŒîP“ÒØb4auæIe™ DŞ¥ão±İZL¢.œ°4Û4°aÉ†íŸ†tÚKjXBd˜ç8;Ur‹(Ç[ük¾°h’5$ÓµR„Á ÿßàÃÎg½¦;«*PÚóp+“ÿ7^‡·3µ,Ê“µT¼’fåö‚ÓIx°æóÒÍìNI9ˆqpÑrzÌ†J¶è 9ƒ®ı%Ø‡W§ŞËûû#|2]Ñ¯ìá"M‰p½—°4[Õ=9-Lo×ó¢rpíËšİº<d—q'…FF¼dOâ˜ñiÅ:çµ=jı’Ø!R\~áËáÑ×¨,+­7õ­R´
à“¥ÕN’ÜÀJtÎ•¥¦ªB˜ÈæZ,’SÄÄS«£ı4
\™ù¤¯¶i•ğø,G²æÑp)âŠ{íñx&L×“yŞÀè&,Q´gòñy•ST7j¡Û}ı0Ã¯bG³+eRsµj6şe)C3É…¶»'/î2g´gÚñvÄEY1¸ó™ß
z¹ÉƒO&j¯p?TĞ-«7z
Õ„yítÈàTi¸øÁ1°UÜ°à¶„8‰`Ûñxâé^_¹›çİW¬X]BÚ€8)óEå3MMu6²©>c ÑâîëŠ¹(•¸‹dÒˆ–¢%Øgl&I”QşìÙpu•¼‰!,ªÂj60˜tì›
d°°™@?“Ê?mêV!è'ÚønĞİËy=ŸÌ‰‰†)à,š_Ø:öZ€«[`îÅÒ¬›7'bïìÖ=¿¡Õz8ÓF.QqOßèTEaxdÎ¾üMÇhÔ¾*¨Ë9BŒë
2D‰¤ÒÜ.ÄßÏU±ñ••=ÙÅ½Kaj¢61,3U<¬F.áâ÷lô¦fX/‚ãÒDÏ.Wºé0»GÈp0E…‘#üùş%¸'¾h¹é’&¢tºò¿­W(íŠìç[½u-u§fùq¯i"~ö&†y†¾²:õ]û…—ˆ˜µ•>¡TÉ-y+s.X8zÕšMVSıeâ¼ûpW‰±å[µ£&ÎäI;}K\b;pm€O¤îú˜_Ê¤Äì
ˆ	2‘ò×¾QúÃ«9íŞ~8†’ò.Óië‰Á+°ìnx…Ú^@Ğ\·2“ÚÃFK 
ÙêßTó^C°‡´•\-YFyÍêî2±á¸•x†~(`–¸¤ m1´©oÚqG¿ÛW;½l°Î †>™âû‡&öÜ{:‹ôû÷ ;n$²’\!ã·_–£æĞ¥´éĞä*¸ìQœkŒoÙkl´Èaß%«›­;0	[Ÿ¬@¦A	±ˆè$¾fÆò¾h.Tp»~À‰ÅÎ‚4fsBœ®óº
¡S¤&Ï¥>­fÚdĞáÜİîİ!È¢i* {~5¸ô6,zVadVº$ŒßæT9à*¸¾.?\SğX½ºº†Õ¯°:ğ1xrb:µUhjıÏz»·¼œ$Ê¼ô¿ö—¤Qã_°—L”¬€¬UÁq@Í<fÀP(Õcã(wrÖg…İùbşJS–Trÿ'‹«Ãjÿ‹Ö1ıüŠLÛá¯;W2OõT	|{ÒÛ„F§NÌËŸ/#G½Ò¿}›o clOÒ*¦¨N¸ù,«Ü€¯Âëh§„È¦“›É†ä6Áty(ûÜHüÃ†©DÀ;'±<6#]›İ‰ƒ(â¼/Nx>åz\¨ù6€e·8‡Â+À±{–n´*åÛšUªÀq"ÁøPz¦Ÿ#eCläó'¿ag·	cD¥ ^B]®”Á¹›èÆ!š¶ÑÀGÒÿ^~Ñ)ùj™6'Ê»Dpş£«Õ­@¬’j a‹uÁÏ‰B$Üœœ—Æ}¾Î™Ï3u+’ÜVÖxHğx5ûzƒ·«Kú°oá#@?ëúñ“”»ÿ;Eaä•ÇqI+ŞxĞÖ½{}Ñ#BOÒº9ÄòBü¾Zµ`<Â”Ö9Ó=O"û	ómf_WĞíØ=='ZIšÂR1¤ô<‡]g{W·JBcCt®ÈB¬×qŞP:Ã>>=5äØ0ªôjeZv ó°šJ*`$ÉTè­f£¹lÄ†ªõ«836Ó¦¨»=ƒçdÏïº#Q;Åàï3ÂŠ ¢‹SÌ¡ QékE¿oBú(}2º¾$CÃÑÜp¿iİÜ ¢1ø?Œ<ğÿHÉîq˜+tŸg"x×_8İØ9ÕÍˆÍ*¸î´í.ı2ÈJ|_Ã‹£òâ#2¸8jöï‹›`Öåİ8…'i)ÓÈ˜®¡LCØş[<$–Ã+…ËÏYâG~C ã¾ª €ÀU™ÄÇØÜ¾ˆ{ı²nyÿÿ­e¨Ûëğ¯Y³F­àK^RHÜxgîaÚ¤E‡£ˆH¸Ú3v{O_7ÈiŸGğMÈß›xr~<’èqZ¯Í¾Kôa4ôG;‡%mL’tRv—¦¢<°q¬IÔ¾e"Ğu²öcá<a£µh©A'°°Ú›cR~'er<A‘<­F‡éDg’°œıVeø-äŒfç]è£ñRÙN²ói	Ãÿ“a÷*°öc·Uş¾|ö\A»QmD†Pd«!İí‡¢Çˆş¨–ù7+ÜÖø¤s5Ó\x*oÏ•a` Ûı&G"‡ö­£'j¿7[xÊ=Eòj¸<˜Æ|Ê*Ò.*¿VsKø ó·¾D´ à¹fY
s%+-Nû¦ŸÌôÇ×çÛÿ9%-Üw†Tyæÿx¹í®,°ÌFÇcd$„ñKX­©Òˆ?@m­E§óbë'1OLÉŞƒ Ì Uú…ï¦=ì}j²Ğ«ª’@ù ,ÖÁ™MÈÀôeõŸ„+ˆ³XÁtçËl’f>Nsàú¶Jmğ{\Á U©P/¾ÕT›ª¶éıÑîÛoV
?ßn·ŞJë}ıû…ë :1áÜÅã®Z3Î´8.ª0‹|H«ÜRÂ#°2V[áÆÆøıUC÷c!Êœ]Ò¿#läªJTÕj EŞúÑ`F1‹ë=šÍÙJUÄ*Ğ8şZ hDGy$á‡¡#jÑ]0²%8†æ«Kf-åÕ¾FKx‚öA›#ätä];sÑBŒËqjlô”Re!í{¢\wT“¤Ä~Ş[¶÷Q«Læò8°3AØ®¨Ò×útìQA1¿œuåO¤Yœø`Ï?!Ò´Ûş¹(`ñº¹æ5¤ƒÑË7Äı¾	]6ázÁû›Qòã«åÆÛ¬øÿ‘²?Ûñxó¹¾q—'ò)í+IÑ9)@–>‰Oo±ÙXRÌé9KhÖ‘iî”e2ƒ~Ê)SÄàjØµoØæA ÿôÊöÒ(øªtİÏ÷˜{øÜîvaTGé´fEİ§‚¦GıœÊÒR` ;j^EMO¹@[}‹8şö9ÚÀƒq*6ô	ÖU–ƒ™›zÏªxdt	–gràÁku2Ûßhkÿ¢úüPÛp%kİn¦™.ï:= 5¡Gè) éÒMÂèÿ’hvÌê÷ÃúZ´n §³c#sÌªÔ^™ááØKq§P`£0[ıçÈˆ7Ã0±_¼«N´ãy,¥a3~•Ó•ÿÏÎĞ¼^ ¿gù…’ò»Ï*=’÷.Òî‚@kàqáÒö²¤¶'…7kS¼³ğá:“i3GîÁ×õ õ”m‹%Å†½É¨,Ú_¸+€¯d4ª(90¹CWiŞ.*=“íŒA`xnì bò2jÊÔ_šéö–¿.É	±Øé®î™áÛ—Ä6r#¢ˆSZ.Éø	_>Kêg–¦bXP]{‰¸ ‘4DlÎM üùù ­`1Á·]ô!ÓSáE3§–92ùˆŒb§µWò®]DR@¾£#=n:…_'‰›hZoƒP‘2$×ÜàN3FŞŸÓ`ßš'såœêx	C¤)Ò·—RåÌ£óm zUØäu]0úÔãÔ‘ÿÙÌ‚Mwn€„yÀìiB}™úˆyi[üOo‘(ùÁ*»‚²Œ
íÅ€Sû¸Î _9„¿â¨Â’oæ­é*ûv)ÇX/µïŸÎ{+up„%…ÈG{:PìòŒ1³ûš·rh|t‘¥`r„ü~ò“Bfº…Q¨btf½×GºY…Iº6†òıoñş!›F$K¤)ô¶*¨f0GeÿÌ**S(ÇÌÊW¹é`ù(Ku?ÔdŠ·}1PYÄš£71ÏpSÌAärVE¬°½óG1´.Éa	[Âá#šÔ6*Ajv¯{fx…Áoø¡aCG©A0Rë%IÉ— ëœ¯ƒÌŸ%|5«Æ
ã‡fG½¥0O’Ôˆùp~Œ‡ñzı÷é‡‘Z0ÄétYdEôQ{gé)&MğæªÜ3›ºxğN‚ä¬ş(*º%˜õ­9û3å5…j}#ê_µwÓ÷”úE¥«°ùÃË"ZØT_{ó°DŸ¢€÷ı¾@uõ’q#o¶ÖÌDÕ¦W´90¢/ÆóbÅ®eY;W;2–/Át 53W5ø¿Zd`—Èˆd™©÷Ö*B/¹‰[D½"]ËGÚşd#J›Ü›(XPŒiKSoú§ÃO –MÖX6ûGóÓJ?R†®å²Ş¬<-%.ì*Ä™+8æÎŠÛìš#ÈnªÓTaÃÓ8#}Ñ”²éå|\(c¦yœxŸ´"sÔ¨(P¤#fÌşü\»?ù™ê¯Î~AM§&ÌÅr«O˜t¼Ìò_Õ%	Ïj6ô"†«Ë^ÓÛ‹&B˜ëÍ1K¡‚ıT6[h¯ŞIb,©ÔÀi7ïÅ„Áp*¯ŞX–Är$×*go˜êúT&–R§%Úápã¹Má’üm7ü&’d!é8‚ŞgËVÃS˜ÅêÛg‰ì{=‡(#ˆX³	¸Gg©W˜«bQ:'w‹Ö’¶dî{åM7ê*EAr¿}m "¿ {·*<Zz,·ì7á‚Ù{¥Ö­SÉ£ªfGÍbkl•TªÈ6ÅA DV¢y9ıÒÚ~6íô’ÎàV”Û9è.VÚ OXK4• É¯è§Œ›Æ¬Î/x[K¡¦WÊ¯¼­³a•T?æò6Z¾¯—ác–¶˜¯|\ì|¾!B¬‘sT»nëpÇp-ÃvÊ—/½ğH`7É	ñ"²è÷ŠÚŞæÿ ¢H_£md)	[Rî–,g}KÅeI'¶¾¯VË“v.½ÕÜ,™Õ%=Sİ|”kÏ„2~O¸(°m@­óI2šEuĞ³Ã¸$ìšü…ÚŒé}a¦ï”ú¶S{Çôj<Kñ¨¾3A‘£®›ûÎk5½òÎ:ÂWÿ¾<×Ÿ¶aI¯êTçÁ¹<êËĞŠ‹ª.,$ójU²Ò”F9ìÕbd=«Œ;‰ßNÚ8ÇQîÅ=TâÿÔÕ"‘µO3ùMOpL{Ğ‡‰õ·kq9åêXÌ—Yãq}wÁ¤©ãYm‘ö±û“a§æ@¾üÉ`»P~†—‰ ü2öyz"26l2Ap‡ì~vô@gèöÍµVŒ³e*Â´‘2¡Ô¸¶JßÑL£[Ôæªè)öb¼0Do"öš‚Úb<Ö-*‰iÂ™‹gæ+â¾¦.ÑyÙN¥Š¤ÑÒ9~òë+­FÉ§½çÚYmGÌÜjdû:HJš>Å–ÙÏhŒ9ğkåÉó‹Î4AœDÑ÷läĞÖó÷z“?DçºRù„4À+<2,ŠÛ¼‡{öMğÏÂ¨ÆŸY„<_
ÚÇKî~Ûmóøã²,µ¢×¶‹D2ëKe"†?`º&[><ZÚâ4œÃkÖ!{ñ¯“Ğ¦©Dó7û(SzaÇñ} Š8ÒÊÔˆMígà¿›¬ÅWQ~†b²¶Añ³+Ó4ºOˆİ?L}I‡ˆÌÌ~ÃµYIÇ^F"ˆÑÂ}´TgÎÄ› âw§]Y#iv[l²¬@æ8†sXÙ-w¸ŒXY$M”–À…‚â™1UZ:ÎU¼?¢Ç6õSi˜ûhiéÖ^,ÓÚQã Üè¦“B&qém¿i+¨ƒ‘ÂÖûeÖ+`T-x£yêãN'¾’ÍÎ·•dÃ©Îsy~â)ÙN‘uA%æ:êv'Q<}Tş°ª³f©™uíöKÕS„êÇëúØ¤r®õlxS\µ†E <oïåÍ„ã?1s=nF°5
ºl(·Í»[÷Àœ½•˜¥ª-UÈ“ë
ˆ-w-µ°¡¥¢²X¹8«FÑ(Ø‚üêKŒ×S¨í=Ušß_Ø"–i\ÂÚçç«séVsF—K Ôÿt¢÷§F«œéÍ®´.šİWsä&œùSêblC¿!Ğ™$áÁbV}Ÿá‚-®g’Æ!¨ˆäğ¬Kr+±2 œ^îcn0[Cí.ø};>‚2QƒU¸)l’ëİXËôÌ¡B3ˆÍÅ¶âaYÜÎˆï 'x]@±·V2ƒ¾Õ2× ¾§[É5¹¯T›‚®¼ÈŞ2”nºw£ÏJÅàDLXúòÛ²ğ9€Úòz¶|ÀÊíN¹ô·Æ~şØh[àËÀß/¯Ms°Â¬("–•×(;´¼ŠøÏÈ¼êî_ÙEÎáxË)ÖŸ}q q=ÉO›ıé†‹ß‰áöî,İ/|Z|N’„~J«SÑñËMnZì‘&æ%ª¹Tñ{n¹ÿãüpÚ €­qáharKû˜d)N’1ËÒ‚|ÜB¹j‰D»Ô´´‰‹Ç—hÆQÂc,
ö¼	wrÁ9ˆá:+ôdo6Šv­ùÊ–BÈ´R¢•ÿË^‰óÌfv-Pñ¹LÒ·ÉYQ”¢Øû2š
Qa–Ég4§‹Ûõ¸ínÎLMïâcØ8
†ç²„¨MB¥1‚8Ù:Á=3³NÂÂ]¤î¹¦,ÉÜ‹0Œ}Ô¾Ú‚òKØ,íäql'*¸ˆã¾ˆ«¦èÊÌÒÿ\§*fµì²+S	ìï*ƒ:­…x(ZÃƒ¢_0O7¥.ìÕ±or yB)°û»ã=RÎSÀÁ=sBU†ßÜ×Ş Ôu;€Lô	s¬tq6z)…X:H±÷Şú¦Ó=uÓT]èu"Ãe;ØG#vvÌóD¥­zq2=Á[éFj«7 *ƒË‘(ØÙòÈ ÿåÊÒ\].Æ2õÄc¾—5Nİ¿¤Şú4ä(à#£ñy¦jaSÒèç]|’’Üv ±Äqoñ­Ë1Ÿm‹Â #ºSĞö}G±±B{Ûiƒ2ªÙÙùØ‚-Ó?€I˜†Î@'ë
¯ğ…„&ñ´Mf+ÇÅ„Uÿ—,°7ş³™ğñÀ”yrŸŒö"#ë³ìïÊ&Ì¥…Úø?Ê6/œ)ÀË%5ıM¶ k¸#üh¿&g¬íGUop-ŞB;L™"e3î“;šÀ|şbÆô‘Ò×â“òCD/ &
É÷œÏ¿Bm:­ÙZRí†Ô4á…«š¾½ŠíÙ$¡A.ÛLozgB4@ƒ ÚÂˆ“‰öë»s9sÌ|îU	Ã_U”®)¿d©†ÑÃèM% ÄVˆE>İG™ÍIäªQzî÷Î­äš0¾|‡»GIqôù‹éËD{eE1)¼/–Óº¾;×÷×çÌa[ñë‚œ+#7Gx(Rcig×}h°	wŠF0³R´¨äX‰¶Ê¡Kg?²ë”İ–H}c*¤eWQt¿Håf¯”ß/w|cFÀH"^'66ÁÈbÎD “ğŠ/VÈ/ÇLtëš–J˜{{vhYJ…¢Ó-Á?ô),	GW}.…MÅM´°˜ùP½~aÕ$˜bÄ7ƒjuÑB5œ	%ó‘¡ÖAÚ²MUß`·Î¿Àú%ÓÒº@ğa§À2äŠ£Yì¤`Ñ û@à+«ZºÇ’ñùZ[ª÷éÚù «ÿ«vÙj>Vèâ~Ù¸¼F		‹™f[MÈæyÕª~X4e:Ğ‘òîá¡==;uğÊj]¸9ØºRø;<êZ·Û{ßVÈÑ…¦GªN¬F¬0¼÷Êø}VÔ<ê ŞQîJT'Aë­…ÆR–8M-8Ì¾œ«ÅÊÄSG7=[óÙj€ŒK^?—‰-å&ªÏÿ ûo ’‘"wx) G˜Ê3+s‚r	1QìöÎ28Ş'ªÇ„.ğ“z‚ìb\2Òˆ4Û{x¼‘™ß+k¶èƒù-;q't¬¾Š‹N-S7Q¥¤Ç¶zŸ¨K@ğWÆ5á@l²ê=òõÏ˜
F÷ ¸%û;]£Ş}ERçAõ~µœNAt\fTQ}ş‘€ë_ĞjdïÓHğ	—Ø«-AÃò#S€•…åHıjµ%Â¼á–#&Â±òNx“×<õàŞ'}0$ı”ËÅ¦úO¡pø~ù=tË?éÑ”˜;Í8ÒÊaLíÿ9tÂr¡šÂ5ß“ÎĞÒÖbqşRYÍ"À¦Ó?Úêô¾s&3G¨?Ë“ÃCŠ*iV+¥ÔxRA‡i‘î£A!™ŠÔ”Ûà“İ@²<£ÛJ„‰NMœêvl:ı$õ½cHÕ…²²ØÿzXÈšÜE!ëÔ²åy½nÅnŸ‰4rc¿qó¼}ãÑrŒu3•’ ÌŠÆ[ßïâSšÜdD‹¿·¤tK¿øÓfp@spReXp¶õ#ş‰‰:S5kJ·°¥<ªAi›/†÷³¤xiY­Íªï°b˜iÔ™eŠtu¯¥ôô¢©fÜ‰Œ[Ôn@‘G–¦]¬¦3d1‡ÿÛgfÄã«Q²®"$U‹ı*Oap‘N\şW–ä£'zëÊ—¯¿‚`5Gës<üS6lŸR;bPù©Ü/f‘fmÏ,Ú•X…àØ‡ä Áä÷Íå,ÑãÛô(Áîú|¦Å’óŠôMvPYaªU%¢Œ%Æ§ÅO

ö¤ÌúkÎØp7§Ùcj®áØn¤$òÁ~‚Ùe¦ñÆÄo¤È¥j"›ÍÎĞÚd{P1ÌM1wzÈ×‰æu{³ÌéÈ:„…a1sn	ºÚŞäA°‘Ô®LJ”[Cµ‡c6g;²ÍcêFCÑ¿FüB6“šĞ¤ô g#G;D\ËOš<² †IÏ5ÀCA‹å=ùÆÄùO‚ÍëY×„v9áÒk´(*q:C•oßµG¶—³´z)KÎwÒ,Ñ¡¬’İ»¡ƒƒ‰m•‚9Œ²—ÒŞ¼ÄÑsI6Ø91° ¿»CúXÑğÔ:ÀV
ûDÆ†´¿ËÃÏ¡Âx 1,xz
é J£’Ÿ»c¾¾–ô×æ,‘2‰–ïGRî®Ã¥$"LõŞˆGÿ€h(#?èWA¯ø%ã¿!l5éµÕŸÜn×I!¡üÅÅCœ´%[¢p€@¶åÈ&‚»Lİ<ØFød|6±x<MœK°Î©(Š˜[ò!Ÿ¸£§›/V•ò% Ì8ŠY£Í	Âhÿ]Èù:eäL9>*ï›Mˆ§T17ë¢'ı“´Uúš@8‹À¦Ÿ2i·Ôœ[ê¨ü÷~fGïZªw'l0EUB;ØCĞ9é‡_IpqØ_Ë£†ø"suĞŒÀWäX$Mî”ßéÀ
pt2–°àÙb¿0{[`“œˆ.Ì{9! õ^©
?Ë9§p³Å…a|ÏuôœM;K­›C¾rÖ1q„¥€|Í>ğÏÂOáœ:†Ú>f'ñŸP¶[>EÂ<c¦zİ
è§úm°víˆ£'ê†âg#²ô¤ékcÄ"&ÊX§l› ÜËú§_¹Üæ¯7¨wš|ÜÍï6ĞPÅj9Lá%ãNªn¾ùtB…3¿Ô”k”nWmœ%·oJP’ù{yãl@âö [¯(]‘*np—”ş³¾š«Ø…FN£-½4OQ'²'¨9–G+{S_âìI:é:Ğ®¼! {7Êº´Vàdµû¹‰Ñtœù$B[» ûà°
±®¤=”(*Ù#F®æv	zråÂICP¿@z—:oš •AÌÍZ_FìOj˜â†9`]*I«+´ZßKß× TiL&?>$]n’+ÁTÏÏûsš}† Z“v=¦Së‚yD›’86t³Íû°B4	41Î‡Íô¦æ-3]ªÊn\ËçfL9ñT­†kú½[p_şÃ?rêñUÅ‹Ö‘W4…Ú™Àà_ÊuÌMçj%dk…^J	æ­,Œ×õFL¹½ğÇ•†ù‚×‹¶û[öá3ãš¦¥:k%ÕåZ«W?=Úµ\o¤£àqş¤kq<cuZ¼‰rDùyBf¹-ü	«!õ´şàuîw½Î.CÂ? :ï]¾åÑ4ljÚ{D(U‰É±Á²WîW2B’”9vn"Âô}—¸±â	%×~óLÊÙ¯üšäO¨9*.uŸÃ%-ky{µöÂxíÊWä¬°C(3IH­¤uI]ˆ	á7Ü¶5C)Œd‘u<qê¿i€µgğYŞi9“[Àƒ)¸úö 2Üç„2$ô–_u%ºÂ"Ví¼‚¡q*·¸·’µ{Õø,_:ÑëXR´OlQ8gEH¿BAêêú’B4 ã“ØuµµñZ2wg-H€Bxí‹»Ğ;pgrÂÜ© µßdHZK(&«±*±œ=õN¡uNçÿ§ĞkÌ3½ìñÉ~$l²#˜"Z¢À*÷?c}à'¿›ÍÛûYqWNéù¶½r/´ìıÃ£ş17¥ìKÇM`)ÕªjâĞ†£µ‚]Otœ‚gˆ`TD”£ÃlĞ6¡ø:ÒjKicÛÜfºùÊ:¾6sªÉ¨-¦ËT7—ìÅÊlåê€›š`¯jŒ`îmÖ±N¦-~H9¶$¶êÊ¯ÎÊò.‘	òÜŸR­ƒÌ‘#±ÿ“ÌÔ1]XEUÛJ”.OĞSˆÔä¨÷x'he‘8ËOÉ9¨8¾ Ş¹9Š.@q%±+¹Õ…uÔ‚w#KŠB£ãµaŠ3æIàØîXc‘N‚†Ï‘z÷#-Ä¨„öQé§[<or÷@RòøcG(Õ¥Ï,¸OØ¹—{¯É­æT?j˜J¢tî0\ËOø~q]è~…€zG–Z²JuRâ¶8b™z}B×Is³ÇfLtkË;CR'!%3íSñV-±]ë%;å2éÜ›T7yi^Q.0âs=\ÕoŞÚúz¹`'_a|ÌŸ3)yìübK+J7ÚwşÁ_Ç¯8›(8ğ,!6áØòœh»WJÁÍ‹îzÊøuå‡¥>Àª*8¹„Œ)ÛFB`J†ì¨‡û¦ômVù;DØè'jÕQŒ:µ0Àw–F"vŒv€¤ëÕ|íµ;B«„­ªVdş4‚ÒTñ‡¾O»mqXÛİ]Â3Øv yü£nOºÙ[›ßÑ«¦¸šÔåcê…ŞÒäš—Àp¾eŞ8Ç0µ®‚,çâÃ³ÓãdïÛ£I·”A8|(1k¶¿F•EnR‡©Oz')“{­í‹3îf;89ŒÍqÎŞ¢z¢máîìé¶a uş/Ç'ÌLî¤§‰à†¨nXJ(Š¢Í¬”LaÑJ„ÅXS@çæ44ù¿½ÏĞíİÚ×õ/!ƒÔñ9Åá/#æäˆ€|mŞì0Ú^\Sijk?ü[<´A¡ìñã¯
”Ô ’›6§ÃgŒÓÛRTÎò¾ød\âş¬şÛU~ïóVJÌXÒRkMé¤£ûæà‚ì¡±tÅ|]m9ÈÍ“µZkç,ÌêY[‰C«ÄQpâ.C‰®7«1¥LP0ı |Ü$¢@©‹=dPĞÛ!€ÏëGä\Y„MËÃn­òurìË/›
I?Ú:Ü›P	O›,ö~â@3*Ö»mğˆTĞº2__ “ŠÉÓª!“«èI'tDK›»`X¢§NP‰Hl…Ø?±‡Fl<ı¡DòZQ·İ’—¢Ê(ö:§†¸Ø›´œòú)5æl­h´!]¬ŠY›kÁfPÿÑ¥x­q3‚õã9†ü·í&nèFsõŒxc‰=ÊH‚1D×‹¹‚›éQ´‚‚Ü(]­8%£!.hÂÎ¯ÏËë÷&¨%ê-–{…Ó…ãl·"£°~õÿM¾q’™u¹›°!ÍIÅL 1Ì9ı]=oÔÇı6Ø‚™¾•Î;Ëh£D±T•íØ_K·™ÿ&£¹L¾U÷şbÛ~Ğ•Ö«Ç‹ëŸ£W)½nvĞ´‘q…—_ˆˆº-^şA7‹_Ğµc“óê¡Vt¬d–DE|ûÑ7`‹E*Š„—5:*àX¶èAß ©HüükÔÜ0©RdZk'U¯cP¦ŞÍĞÈÎú˜â‡µ²FD¿¹€`¡ÊÌ,d·õ ªOĞî¶á:ää'ĞÃ ÎhX‘—&‹Óû¯d?ÑÓ<Ì‚Oµ`sw¾HFBù¬ ô“ô§Gàë!²rƒ‰õ}&”ª+è‚êL#ÿí÷'‰2.}ÚñfØvûş6£âÃË”¥dº¼’]€ ¤TrØÇX«„2ãë±s•j­}³Û¥)Ò°RÅù¾iÚ”Òÿ#LöYäï¶•L,öD9UıRğLJ'¿ğVT…ğ°²µ`ãæÑM
lQ¥§<®[=¸èã(t’$™õY ª^“p%™vÊ.ªƒZ6JgzMÕ£Ô[È6Ïï×L—gS  i†äXû¯»ksjpûäU³5>z™ë6ŞŞö€Ãıüá¦ˆ½Áº/nàxE†øw;xeÊ§rº Wjê¡Ú%êÄî.¤¼bÏktñ:x†Ç™œÊ#šôL¢1câ?®tƒâSO:³IœÏ™¼áåµ8 R‰k¨’öÂÙ5á+Âx/Öã{A¸-ŒÂ®ïçğf~YQÒód’óÓoõ3yw\¡2Rø£¿ÊÉ±Ùßèà®±Õ&»+‚”cı!ºåX7b
t½»£$W¦ €/~¨Úh¯zöÕkÂaÙ•ZHtÖãö±	5ÃˆM¼*«¦ó2ç|ŸB†ò£¼V3wŒm\j»òCAŒ¸Ù§{3,¾Ó·~5`×uÆ0ëx<YÁgãÃÃÂo-kjÍŒvm›ôôy´^IV¹áí;­f?|N	¥£• 8q|›Í5c­ü¼U†ãğù(¤¬ÕQ·™øŸŞĞ²­EÈ³r4N»”šuÀèÏFÁ1’Áı5>êtRÖE·¥ù[@Öb¿ï ƒ¦Ï¢MOÚÇƒ‘$j¨CƒåÛ”ÑõÂ—Ü¢¢æ[3‘¢?ÛdemÕşÉï¿v#÷Hø¿Æ-·&ñén¼‚µ;æ/{Ä‹T-”§+¨lİyDq}@!7€ÑjË)„ÜDÃob9ıŸê¢v»•~¦Á¨TĞìL´2Übsu‡A“å–¹o%CHÃÏ2*úkô,8eg“à¶tÚ-”ÔÙxfR¯c«¾ıÃù¸HuÔVÛ5÷d5³ö2‹bÈÚ±A†xÅÈHéBˆº›M°½5Æyÿæb¡—pÜÏãË¦ƒäã¡¼”tA i’{/mÌê¢+oís¾òhjÍ‰´Ü{jàiXş—1 4ÿFÒ’F<Ñ‡›Bmw™ øM>½XòéÂÙ7‡™¤ÀI±‘P^Òê5úeS›ÿõ^ŠÍ¦´8‹İû€íÜåÔèÇp­_@¦¸l0ÿq	†9„
ÿ²ıÿ:ùKy©c-­/;örÀõ«ÖtK0)èp’ö£&ŒRï5’ì²m{ÆuĞÛ$îxª—zñX=oá?§\ "K	wFœßf+c®ĞGgRc "ØáÜ©Ì>LmV¶½' òí¡N¯}‡1¥-âA‚ö<;GáÛ´+c«éå·×
¼ÂŸµÙ°W^ï•7¬µ²a%…"¤#õ¡}Mvîæ]%[—ÅM3A)›,® ”z5ËuÜIB±Ã³üŞúA(´m„M²ì’îõSÇ®÷í©ìã`£CÒ½mÉBˆc'¶U!E|êÈ_Ş<¥5!¢a¯ˆ k~ã9Ö¬“¿Í.*1°åÍ…å&™T~|İBS£ıÿ{ÿøQÃÁ*‰Tÿd*••û–pzy=‰(½ ØêË4í5—z.¿©ö‡‘i˜yÈ›Í§Y}W4Õ+H+S‹MeëB½-ÓBeÅ´RDS6SÛ¿‚Øç¿ˆ>ĞsTà¨´>éOšÏrÒ¸T¼lº]E.´Q–OejâN0Ì¤—Ü-á`ïÊÁO,WX"ùş4´hW2ùC¸°Áx)Só@M1šë¾‘³jb»¤Ç¦„½.MWºûòÃ9÷†çü÷? öÕVB?<™€¢Ÿ˜/=¹Î¥Áõ\ÜŸKü†‹ÍËúÜ~½ÎÖE2”G—%Ùø'5p.™ŒŸ™l‹êrU½GÒaMŸwet6¯àU(Á‰ˆmH–D¤’˜r¨(7‡!óğãw£L£zJÏÛ‡»Pùw9”¿ÊçñpuVâ+”(=ë¯Ä6&[^¥–y8 Â¯•^èğ¸\Û Ä |¡îÕ?İoOÙ’„’G°Yµ"Øã!~	º„(°%şxkMIYJºñ©µùbÇŠÌ…»“É:§ã˜ÓŸÖÛ±ì­O§&Í@Ç·Õ
U™Š]²|Ù†œYŒ©,ATJm=U›=Ğ.Šœ¤$ß½–Óyêx^›ÿCî¶mÏj¬€ƒÖ6™†«Ş€^ıSúùX'6.ÊkŒÌ^RKÇéÜ#ê‘×Ø1£¤öç*T»-÷Èı³`rı]Û>¶ùµGå”ÈõSè~ºAW§¦~%ØJÕ5˜9”`‡LUˆ‹oÌ·&é2`æc>›¾tË<ñHdEî•-–/¾*”Šü…¢€¤&AÉ·†Û~š,¤#Z,»­Fôf]\0(V‰Îeca	i½w¯¢ 6$òg;vÄt_™j.X»¼Ái_ÿ¤:í‘ç|†Şïv‚‰’ ÏØç²”®î!¬©ù>ˆ1,Ç!:|¼ôû£šÃI†çÏF"Ñ»n­Hİgç/:?Lx8¦oä²a… ğY<Rç˜Ÿ øYVít	šÊl.,Ò‚ÂTé­øŸä~˜üˆ3O’ĞÆ'Uò–ÂãæşåQÓ¡Œ–oiJ#Ú¸½Î°¼^#™>…“&¤_ŒÀÔÉÎ;£|c¯íî5
ºE¿û É×ß%Ê¿ÜFjgÊ¶Æü…Ï™z†”ÈùÂPX.J.SØPJbe]íÚ²ôÓµz.7-]€Š²[¬¬Ÿl3½F™…‹h-äÛpû­š[v°Ìï÷ÑÂ„+3¹X»ÃÇÆX ïªÚ9–Léµ@Uİ)â:æ†>Ok-fÎãr–ß3D|ˆ¢ã &)hbªõà=SjXøÍ/5°èU;†œ@#Ó¢pošÙß”ß¨H:³& ù~jŸeÊj3ÌgNÜH‘ñvI´vpùÊ•heŸ9¿óFğ _!8FäúWÓ†Ğo˜:åñ4"¤°ˆF\½(Ü±È/PñŒğ4L±#w…t+@%‚å"³dÖ¯`ø¯ç§+#®[h„³À4úİÁÒ)°„½ IÁ%@”ÈFrÕ¯oÔë¦êhŒLÎ	Á„íóàóZ8cÔ6çïÛß4‰ê&àéµË …aÌTÏÀÿÀNŞ·4CöŒ?2Ø<ùµzÓÛÚ'õ‹®£NPtZnY µÂ¼ªIşÖ¼*§f:””ÙŒ9uºˆÃ7Áæü”u|—qƒn¦3©KOÅü¾à;ÄG3:ŒˆçmåöhĞ¹\„o]ŞÑÇ§Õ5Ì'÷Âq¬y°ó4‡7Sq¦ÛoôgJ’g11@ò.ã`K˜oØÆVQº!°×ÑÙµ8`°‹#Y£Èrí3Ó…{¨uÕG½NÀa‹L“ÇGú:a\‡3°­4‚Ë­½B‚:d’ÿ~ƒ9tôé›æøó\úeI}KÅ	 Õ…¦ê•4<”^š)¶ 5´~|,Ëì	h¦x9.xşOÂ…bìÜDPÕà×şìÀ	1¼ÃGf2©fë÷Åß	ŒìŞ³¿"êÄâ¦¶ÊÑözÛÄ¼§¾ÎìÜ´ùob°Bp2ßª›·¬¥’w$\¿!3 –b,Ó¯¥6ÿ;Hoºÿ`
İàÏÙèI‘ƒr‹Ûg£AÔ¤AÀL7ÔÏl`™‹ÎõÛ…üŠ¾»Ké6ÉÃéÙÅi_R©ï'N½s× `®™.	ğ¿ÅÃl‰B¤µE/p›%"ßR6/‚‰C»MğŒ@ê‘ÁÌÓh+K}Û:ü„ÎF¢êÜêXó ‚ıe+€øÀ1_V4Øï £–¶ĞÜ½kºaº[!%À‹Ú:—U^âp*±W0ˆŒÈ2QŞü;¤öéäÓüóf^ŒıO™¸4·L#t?#—"‘ P>VXê`÷Ú	^ÿì
Û˜²…âºr”¢·×	hÎˆ[èjÍ·àÆìHDİ,rÎÎdä
&§+‡Ê¿4-@#_]›IÛ=WĞ³$^ÃDöEÁ]fwVF¼/Ú:²;^^è¦İwtÔMZõ<Õ#µ,„Ìş›ô+Ò%°µ¸æü3o<´ğ_â&/0Îãl|2"=J°Ğo…Z$“…±_dPeÈô¢ˆ¨NíÂ 6|,Os”/ü&äŒŠGyqü^ébàiy¿#ÕAñ½™ğ‚éX‡_NĞŸeÎP	…Q®ÊD i’	²\€Ó^\,¬ì]ïwPòáòâì¶r\ÇoVøuÇ¬…Tı¾ªı:gĞºŞìş²éSH&;öÄ—JÑ±ŞC×¢jÙÜ—×Bg™æÄc-
rnyÄù}¤°ñv›óÎxz†sõÛã<}4÷á;X6Ë?

©Ï/ª!­ôD”ª[Tú4Ô²Ò8´,8µ›#zéç64û½ÅK?¥æí1_r€ò(Übí¯V–äruâ¯rô‰ç~ö!®ÉgDå”Âê„ş`a3·`İt¤<Ôó<)†Â‰ÕÛäÆ(Õ%aÖ^ã0‰DQ5._¦xã“ÈµãLÑ#ŠÄÕ=[pRØƒÏÌÀÓîıçØ›ŒKHouoÑØWz?éùPÂC¬>,Sèµ«Õ8‚¢Çºé0î{iÉ16»3‰íş;nhŸ÷Š™MÒ·dzÄè;6–çÊhçP±Ïé*bõ_t«SKgwš÷¤'W2ˆğG™”Úé”<ÇOıÇG]²Ê‚:eøcsÒ‚îşâ‰=íĞ¸è·<nUi'²o¾wÂ—5	ˆ¤ÿ;©5Fpp8kí“Î0G²»ªUrÊìR
Şœ© *QC)ù¸KÒLUÍ‚Çº\˜àïù–üÄN[5ö¥ä¶“¥©ÚMÛàïXÓúØ4d@•¥ÆW—FãuišÅF5-*a)&§ÒäØµà€9%ow”Vı‘”Ğœ"ÁKs‘³€:ª4-Xˆ¢}ä¢”§Ò’cPòM›©í=`¹¼Üz\,x7¤¦"•XàEJ@­/ºD"¨Ö®uµKwˆÜ¡ù¨ó»õïÅltÏ^Å†yœBj…Ê,º¸K R‹øa /y_ŞÔ¡¼¯xù—@\çjµ‘mì§Øà°ˆ¿æ7½ño&Ñãkç‰gñû­?Ñ¦¸Ó@İª>JÖ[Ç¦;#Ä‹¹˜vĞç ¶¥ƒÑ:fVî­yKÇ.’=ÀıgïõÑgĞ¶˜Ú*ƒİ $5§D¼GG‚zi¶hq×TGÉ¡sQ¬œİ$a,‡iGÎ>†-¿ ßætÜ_8ÅÂ«¥7fèË&ˆı,È'wõ¿€ê•åOö» ¾ƒKqßÒ¸œÆo´*™z°³ú$ÜòèxLN5,j0|~Ã¼|€8’BÅØø+‰(|"ÚÓ¡ƒñŞå!™eØØ¬håë‰>€e2•Sÿ‹M„Ï¼õk`‘ xè¸0ísw3µ’Kî×CùOuÎ!ÇS:©¡HÃ5À6şñMºòf]I»µ!I‡ó;=›9ô‡ò’½[ ¨ úÒÔíp!¥ÔQ‚;Æµ&}‰uÂwÅŞO˜”o¯eã5ê‚PSR,ƒæB/Çt=ú×”*Jyp²¡†-ÅÕ”mC£x§b_ê@jf¢¼dÒÃµ ùå™nô)1~ºÏ„5%ªı®-ÉÃ=W[”)4—«D‡dĞ°^ÏÒ¦‘•Y@6dæP(\3xi‘¨3¥ÃÖ!	«²@.À”xÏ¯¤¯‹š”mÌÁzUÉ¤tT²>mQvç{â\3·RF$şçğöœ•>ÚõÃ•5¶a næ=ar•ŞÑš6fzÛ†‚àqı@…
¦œ1N’H£è.”öZ®õèT°›kdŒù/\¹9To÷œığŒs õláÙ¤z`©®V‡î‡÷Ë™Abg‹¥’JP2àç¶h"A§k´%ŒT2áÓ–OŞr1 n3kªíP06/$À®a{-laÃ@Îo‰9³N)M÷9Cö6œîœiÕQ‡ãüNjXŒN—dË6ê•tæ¨Ä¤¤S³€	²÷ÎWÀKı¬Ï¸j*ášÊqïˆ5ß€¥3Ü®Ëçd£÷r–?È’^sØ¬F%íW›v¨¹Éˆ¸¨k~J´ı9hüÛĞ	ï)rİ‚/÷®B;Â?¾Må½LûÚ[Æëfl¹AdöLg/vÙZ•5µ¾k¹Ô	•ÀÆ™œÍı|(|¸5`.Ø Ia^Öä©Ë¸P(šõ–YªyçûÔºYş(o{FŒ"ŸÚÎ‰»}šıXÒGH1WÍb¶;ak-ĞÇ›[_~³¦ëB€ßƒXÁ	xÓ¹©(fR¯É&JI÷ÓÉ¾½»é•RlJö‚†h’ö÷®ûŸ_š®L—t[OzÉkj³4?—$è-M7]CøDõ‘ûúÊ–|ÂÃrî	V÷ÃY ó!ƒñ‡¯UeroÍŠ±	ìTêhBÈ>%ÄÛÿƒg:`ŒKiO¿´µZM¤¦›:éøç®mY')øm¦rÙJ²’°Û3jY-”SÜ‹.‹ûÃK‡XiÓfÓ¬a=­Ÿ€ŠÂCµ"Zu¡UN†ÚÌ‚İíç1¾tsmÁs]şAúë÷”na4Õ²kQùÛb0¤©[²™Cà:<9¶XcÁ‘ê“XÅ´%ÂëS)ª¯c²•»ÑOĞë“Ä¯Ñ“:Ğmò¡d Š,PŸ8oì§Nœm²ôı
qÜ€¡#^´]Š5T+Ğt(=NdäÓÜ2i¤Ñ^§Lã«ÃXöä‚Ê~_I]2‰ÒŞHà©d ±<digã.ìi'ˆÉ_ÏÄ”İIÌüq*	#HÑJ9º
)ÜÏœ¼u#€©r ¥q¾Éõ­‚bñU‡šÏ±Ù5äÔ™Ã‘3ú¬"ãhâğ˜¡£X¡îüQá97¬–rilg'v%Ö  ÍMØìŒFÙE~(A[HgÕ4+®šY!kÿeÆâ¸7Æõ¦
‘¬oP©ïúm§?ZbzP™ôs²¾!²‡äüàÍ_cƒ®¾ddÌ/åW^hd‰ñÇe:Q&©¯’Ï ¥Ge«RÎ¿E‹‹‡çV_L6Eˆ°îgö„cqH€¥•g›aèÃØt§í9Wo¸~¶1rüX[ã@MjTìÓ²u˜c¶LmK°1TR-Mƒ®š>î¸ÈŞîÑkãĞ‘kùğ¨xÍüW6-²î›¢eÊphšæXV:r„ü)sÍ;j‹4,ug'ôzk:›EéPp.ÁR‚æ}ÔMÆËXª!ÿäFAz8Œ¹ğU`1cïˆ7I|±Í¯ÉúR‰Å›èwñğ¶cƒ2…7<‘¹uğh†zäÔRÂ¾ér›¿Şğñ"–úñ˜_åV¥8ë‚«VÙUZ°i~ÑévÌ1³$aáZ¼ÀÉ§^HŸïò÷œVdßä¦­ÚÁ9R#`Ûå®v?PGâöVì­øÍôeÊÃà† ºhÿeó)ˆO}Ïê'¤*Ì…İºj›uNnCÁ}ÚğËyZò¾·¢ÍxI+¨mV£ƒz8²Ûı	8HD¯—ú†1Ût^Ê$Tµ$ƒ±ö±g­Ï®0/Àˆ}i%¯s»©(Ô?ùôÎÇç©÷ÈFùi 3Ğ+ «ÿº³7­ÅXİ CU v¸á%>ÿ¼‡@–[61òŠö´¾Ù5o—h¨pZqCûÁ»ˆI•ß~:ª¬ÏnP°‹ ´7` ¥%LÕÅ‚Øòo‘??5Ç–Š.!Tg®Ú‰Ÿ#as$j’œ0˜‰è7BŸ	8zÙ†›³/^^¼üQvƒtuTP³¸­rdmFK¤+çTÄÓ\BL?C_5nV´;zvµQE)–¸#ÖğNÜ¦èÅ4Ò8f)G~c„ÅÄm¸û©Ú¦i?å„¬†±•ñ°]yöoùK l×?ùÁdZ¦ä_Ï$%÷r=íò˜İ,¯=Iş~#G ­JFarº‰Å©ycù.‚!9|ìœTªlQõò§{>Pİ©òÇµğHÏ|N×¨@4ˆe%¢‰Cj˜Zş!-ëÉÖ£ïóö3¿††ƒ¼/Ì8j.ó
Æ õ'0ˆ„zØ·éFëØÒágj!Å‰=Iìbh9 mVîyuâø*w·¯Nqó“Ô1œó¿‰0õ0k64*ëıäî2¼<÷[íU]20şüïy¤à¥­•®®{ô3qxÇZ.²â»wrDïÖ#Eêx‡,va1cqôTš	Sâp^àO¸,D._â²J‹ælô¢~ø=^QEÿ#¶ È§«¼Ówà”‹ö5~¥¬‹âÇP·9pÛ°  Ğ¸òCqSº¤“-Æ¸= 5¢'¶ø’bfÀx:ˆô £¾N{,MGl?lHÃ@I±ğÊÕø+¹"‚‚ØCuö™ë\>7€è=/*¡Hmq›Íé=·RFİfµğ)uÉÛ9:vÚGª“¥S®ÁoHÌTU|°äF.ô¿§Bø7¥£QTæ¾~«~ğ3îÌƒÂ¬¯W•cÓ|NîÇ:à+0Ê#‰R›?q¤^óän™‡Ÿ¬3»Õ»•ä&‹1-V´{ÓÀ,¯p0ã4ÓeŠæğz½c5Jg€’Ûk¾í¬ª*ŞÀ`´Ğâ>«5•h¦ä¦D"‹ê*äÔÏÃÏG‹—ëÍEö]ªPˆ ã°\3%»,‡°sÀÔ0#XÎkd¬û‘¡Œ[ï›Ô$ÊµŒHO0tX‹éWx8õ'á	JËÂ/ãW_•ÁòÜ—ãñkg~Cú(Õx~õZ#Š°nÑ6p4î]·àDñoë0ôÔô:&¿ø‚±>ø¾å-)¼%fƒ¢¯Ÿ‰*ËCÛy
ˆ­r¡í+-V“Ji‹„¨¯!Ü]¡_‘ziøxgGíü^ÇĞˆä…¿0,21R#k!£âµÔv³F©[±Íbè”s5Ù³c?ß¯übš$hC¦`Ø¨è–^•à=İïivú‰¦İ±7¶÷ê³bE“Çs=oĞ/ª6}ë†f À½c¡#''±¥¨ÑWá¡ZN?†!^Lüô¢İxˆà·º)eˆoh~ìƒõO[¿²$“@Ò<ÈÅ°"lL,^ ÿJp¸İuS Ğ|3VöúÎä+oÛ:O˜â˜—ß'òXáÄŸ-±j{9×ı9†äÒ/Ï¢Ê²Ùs(ÊMÕM|~¶JMÏ)MZÓ!"N$héù.f‘“ã—9ÚîTE“ªÈı“zÁµŞ‹õªnö¿“ÊâHvÎè-~#ÁMŞŞºF«ªHÂÖ[››ÈhQ*8š+`Á ;¹şî!î­ñÃâ)À„Võ÷ö#Ã.øÌLÕQ\“j£"ö¶Q¤‹âMÙ4WÈÌ\½²ÒXãœ©¢£Hƒµ¨ôÑœõ¼ïÆ†ßUÁXÀ“00Ñk¦ßxå4ùŸ'’ZJ›@¦VğÇ§e·@q]/áÎvy‘C;yÖµƒuâ.¢C„,ì›%ØU#ÆOUqVû}ÇüupÑõQ 9ó›üh“ê±ü7êÃsŒoÄ|j‚¦ÿ‚lïÃ^|ã
},–„²LívíçyŞâéú„õÎ-–9˜2jj‘Vô*ºú©2»J¡„¡Dx9Ñv¢çË¼·{· UóQ¨p‡?N?°æä£‰P¼"5¢³[ØW1Í³Ã—†b]Ñi|Ö˜³dÑON”Y“ğCîCN‡ÿõ&dÅ£0šUÒŸËiÜ¥g'ä…rÃˆ‰úPês±Â
‡Æ&)jÎIàÖºA›á~¤(İh˜xâ¤Ñóø¶³›Öéõ„•”]Í‹ëm“&~aöî¾Ñ6fş}.õó7 ivµPX˜Øj³EláîÇtgŞş{å"BGLXkãåGƒ*5ÀÑ
0µÃqìå÷t¢l}¥öXa²z£R–rAhàÛ#†^ÇçPŸÿ!)Ş„Š–Dü³)‘î7* MIB¯Â¤/›¸Qÿ—xü³ì‘¯ë«Ÿ%RNÃÂ‚qà%be@é¿Ñ¢Š”ƒ`2tn“U"ˆ2Neoèƒ°ƒ‡ÅíÿÅÍ`ƒÚ"ùÚRC­º$ö
cÆ¼°£J¯Ö¾ó¬óš"»ò¦Ü0ilÚ6ØìjQFèù´T¹¯Ïcæ¼²¼]„¯»‹£Å´¥9PO%xÂl‡˜Ù÷¤2jxé}-ÕÇ²ÏæÄÍŞr3aÜ'ê¨å(qñã{rì/ÅP%€}Å™ª5™Û
8sM‹ıI{Ì£u“´ªG°¯ú|ƒ›]ªBÊÛa.ÏT‚L–ÂA´ü€ìZ÷zå|n„üı­ ^p¼X”ÕCÍÁ†¼ÖØˆÜA§'DoPJÓ/¥™Òòù•¯ àzµ½!~Ght×n·‚7—Cˆ‡×„;ˆŠ9?•n„Ğé–-sÉËĞİ~ICA*@â«ÓÙCiª†É&#Kµ´]ì_´á;cäËÆˆB£9a|ƒÛ¶ãÓËûU½ °™£°,Ş—+²oWï¸ò—›.#®.–ß6š¿ï·Çştk.ç¿* ßüÈşÇÎ?BD4¤R=±×´…RÅ¯şk^÷&—v3°_â°Á¨ı»6	ÂtÌ3yÁx«{Å€ÎE-Ú˜äåd1C‹EF“D”ÍDÄrfuğ¥N™Q@Ö>ÿ$shæ~å£6$ Uô˜ˆÈÚ$^)ºÔè²fkğyœ/·“Şc–WÖÍ"«²ˆåcû.¸Ğ¦@/èÒÉAˆ-û'!&»†OåX;¼>ÔÃÕ]è¶Aã*ûŸ›FÌc6sœ§-QÇ“qÁLw˜fQ¬{óÔ´BˆæNx#œópRLºÚŒG„X,eöágmñXM/+d7ÅÀ•‹xÓsğ¯Jš³ÑğY”5ğ2à¡íM›‚¨³ UØaäéÍZÔRËQÓew²UäSf!äoü˜·M}¬²³m:r¾0,MrPÜ@“‡(üŸï’7ô¯)BF'Øœ]äÀhƒ/Ì%O!Wän8VõyY¢ƒ¶9ÁñG6+›H\ËL~™¬„˜vC-×”<|Ä*É·d†ÊüŒ–ÿH§Kßçe„¨…ÃyÕñƒfßN»ƒläÈŞ²ãÔNêBP$¬S&8€eƒÜÖlø$C©bMí—Ã¸˜'K„f@ÙbI(ì:§t]¡©XXL[\t©=”˜8	“Èh¥ VÚ”·úÌ³|›€Èß©$ Q}¼€.anGËK … fÎK„)Tbş/ÑÁî	 8
x«r~@~ÒpO=¸àRÖ©eÀÔâ^ŠgéVcíãûJÀu’ÈeÍmB—²Ïê•D†¤TÁµJ‹83½Œ©¨eÅ †Jè$ÁÜe2]÷-rKâÄ¶†´µAéÔÂ[®€9O6‘zé“İ:F`llä_ëÒEÜOó½=¶oë3Jå·Qn™ñÉ³™äx*ö_i2GÈº*¦ğÛşi­1k» œÖ=Çä6¼eİéHw} sªÃwqŒüíÇğ7Ã$¡%s{ØcüãòãlÇnök³û3'è.˜|TmŞ	¹nCsf†|øëng=j,>$ùà”CYÍ#˜ùÍĞïÆÓë†‚.ì Ó]h¶éˆÈŒ)Ú4ŞmµIkö.4%Kím¡”‰¶:p£sÆÏ0şéâ¯ÈŞ²ÒLOHB{Uşç d‚^r-gæëœğ×Ş'i‚l~œÓŠr&òFÆ y˜ü‰Îû¥$TSšêş~ÌnJ@+$¥û…¢?s¯®%‰üà†·ÜV€¤÷¨w>€ÄÍZ÷G~ğ@go’ºïôh‹ÀapİO(‡Ü…#j¤Ø•Êl¯2Ïdpf\èò×D[‘ ’ä+æ3]ÌS&M/î‡äÛ¥DÏ-1ÏÙªñ˜€È/¹HCá°	m–<(§Jëªˆ%ô#X"4Jm&b©Üsµò’1¥<1’İ¥ê7X2•fcïÓJ v¶0Ì4-ddÈ˜rYñ€43ØîÉÜQ!BÈq¾(Zy´—¤nÅÒqÚràçóğ. VV(gÀ¨5Ø)sŸp®A¾ŠïedqÂ[¬²2Qïò†Y!€T}òò7Û¾iô•ånk­‘ì%É<Só UA‹hğüÎÆ©/-¨aşØ76]V°Šº­º|4 Œ¿Ú8®ûnèsc…ŸÌúó]"½®¬Û„ÉX(Áp”P²M^Ã!ËÆùõ‰Ù“IZ{4Z¬½G­m[ÛŒuşaÛ'TlûàÒmÀôÇ ÈœÓÜ&fÄ*;Î‹W‚¹Y` A6§Vüé5µnO‡ ŠYí+€Šd`û	_aÄX±.Âëî5IP
eRCSKˆêŞØ%CRHm–+D¬Äz’_†‹Û
âì·ªh:¶>&K‰ÔåôÍt”e¾ûæ£”‚“Ø–³üÚÊÏİ‰BĞ¶m!¨6!”‹pÑUM0€4ÊO/*û[`?¯Æ¼ºQ‰há¾rLIc.èv£Ì°eöñ1ßhÖÌérÕŞWW}–-µ¸­)F›ï*£ÕH£‚—ìEï´%ŒZ¥Öã9Ñ\-	-õŞ5ŸõŒV¾Á2°ş¤™Ü°ÏaY6QŠù€ÙV%Ÿ ÁpxŸ	
¶øâ’¦ŒJn+¹É3»½6y·ZœáNvÿßp¤…†€iÀ>ˆ×0Q#ä‘P?DDŞ«-YD¨]‘ûzıöüËƒg_®¼"*µÇºˆc¢¼KGoÖFNaí~ntÏ5fóQ5®®ìóûşRBíÚŒÜ½añ7¯â^kÎI²pnÅ_sæëû¬ú´œ¤V6üú
´POW‡¸{É÷ıû‹ö†O[ôàôû³RoqÌGß`)7ôçI¥6xG·UUVÍp-/ú¡+Sœˆg¨ÃwYn.qDQJ–¿*k„Õ váÀäßîm¸cwÂüš¦iö%}îŞIRAà[Z˜‹ïşıØ¨“A~³ ¨ö ë²%,‡`{.REõgÀ?/óU¿|c¨–ºT!òM<¯òë
1†ÎU¯¢$nœ“H3Çp@
DEÂ•UPïjh¼ÖÕaX:k™bª×!µ‹IõÄ›€ây	„ñû´‹F1º¸}¡TÜûHPY(/ E>Ü™Á˜}Âvx–+1Ş®$1p¬ˆÆ:i^ê£¢»á‘ºë úv›V ~0ÍA2ÇXV¸Jr€I;ş—•'½2fz"óÑªà1jA"FÁâ·i­?0Ò6I˜ù­ùWÎ<)V‚§H;„‡«¤ˆKrXw¤Óù7HıúX5rí×^8q2% sÓlXg†ZSšŠ\^¦—>h<–QBõoP?$İëKË
â›g®õ>Åèëİïã=}¢”Wml©Iî{à¥‘"!Qñİ·æğÜ¤(s”çäús_›’ùzš{ÿÕ*Î¿ÄE……Åë.…›Ù½àú¯ßÕrÏ8¯ÔpÑ,úø´†îE¨^v}¬MâsMÌ²¾ X1ÔğãIQHV´4—ıŞ¨•Âj#–kRF	â¹N\4ŞÙ5ÕŒÀ^QGÊ¼^¼Î[ËûıùÃ`´³¿­ŸM¬Ú¼Íş‹ N³?ºgŒÀ}ç±aåu?v¶£hı;ıû3eWC‹IS´•íà(ïRÃVï¾ê¯^¸ ÿŒa0šW‹/²oƒº/Ãƒé¨VşBƒ¼ƒ{"Í‹Œ5~·ğûpø‘Âã— Lüñl]Ø¼şX{qbá86ºÅ.ßwPF¾ë?¼íP+	4“ø®—&üJeÒ„bÅÆä"
µ¹¬·Á¯ob× £{E&ÁKx»Ó_ùú©Uf¤eŠg³liEüú§Âõµñô<¯¤6Ó_SûÎÛ’„ãÍn±•ùõÄ5A8çÆu|ß¯btÚÓ|­ïoØSuAJ×J¼fşh§iKx¿NÄÆâo(M™»X¥Ü_—Äğ"]ÅÌ‚µØá¢ëì'%;U1…¿ÿïÇÀ½F}Ë¶åéıY2Ë‰,ÉÜüèÛyJ§	nÂ‚òwŠë,cW†gætù¾ñ?¤rÀó¢f”¾’À¥Í~(×æéÍ¼Ñ	i”ĞÔûê Ãw”<9n?£\EÁ‹”ÌÚà›96·åúÜ_“µ­ÿ“›ó5;í’«¾}²¢×öğF‹‚Ç°ùÈöø Â†lß¶eíÏW¦ZÕ|y÷¬ºÿˆ<5n‘°çJEõ#±bQ/ğ Â¶'úÇH¨ğ†qc$>*Š|)ùRïrN3bµĞlÅk$ÕêKÿÁ
7ı¤êZ3j6õÊSN0‘#¡=À‹»¢>şÿÿW}2kx'l‡(x2}Qšz–6ÙĞ=½ÛWË(fßG¦Œg–o¹MìPé!şÀ¾ádıTSK”Œ÷S—¼¡İ¡tæl­.İóİÀÓ]"ŸôÜ/Y±ŠºéÂÀå…˜[D<^•ò>(À¸c­—ÍgÛ×-H~Û©	Íö1î™Z¡TÊ¤ÑQÅ°³èËÍJkğŒğIC¤ú<sá20Ú»1jî	… gk@‡†‹€Øƒr¯.\ÊtÕŒd~Ì=ó†¶øC4Íé>Ã^âJŞû¨i[Ø<ì8-±–T‡k¯hP¢?†
\’ÊÂßï >F£­–~>F”Ñı¾%ËÍmnË…jŸëƒ¼		åÜ®öÀ‹ zaçƒ[’”…"©”º`"z2åYg+´Ïz{¶lXÑˆz„Ÿ»Mo÷øÚŠ•îI+¸	Üg±Ÿ³”à[Yé”ŸùŸÙíF…ÒQëZğŒ¤}kÖo®%|–?áÅÅ€EİCŸãÀ¢H·Í4Š»ÿá—ó€§}n²µƒİûÕƒçG¶†Í<ˆ€ıU2^©¤rü.°¨M|çŒ†6	dH§_f·„õ0\Xî:TÀ">;tÖx«¡€±®']—Dİ )=¬ n>B6¾' ÁO•}ÆÉ@{eÔ<]Ûh¥›'/Vc.Ê÷á(©óm¥I– %´õìcó­‘¸'Ôº¬´¹õah„gõE{ÙÂdGœz³vF¥ìâü6"¾UV±2­šŸN]²4AL‡¸H×ÌõÙø›úŞÎ$pé&B”	ŠDñV_?¹‡«‰İrõR¾¯¶ù§>4ÿ[Ê¤lÅ)ªjT•½Üê@àUevû92wõé œ’ºD!3‘Xı~§¾CXÜ>Óïñ!?‡ç¸“3Âp…µ'¹'*îß
ÉoÂcíxÊÒŒ•QjâeBÖ±Ãê‹Şğî+±—õ êÿQ”üŞX£Ï¶Ôæà1¬Õš_§çôIO4èÜÅ¶Íõ÷…‚OšÖŸzrÆÅšm÷™ÕC«¤—-¯0îÌg~„!ÍÚı©–›Ğ`Ôj`ö8<©lí ,b)‚®†Úêúfõ9Æ;ºÜ—ÔnjÊ6×å%Âƒø<¯ßÌãzÿlcqez±Ğı%sûqqwIEå3nAÖ?3;Op­pëÖLSµÓ­Â¹BhM•šrGpÃ¢LFÑáx;)à*B×=¤ ><¡ä'
’ÇÑãReZ¡1 øÊÃ`J!zäÅTÖYãªtjÅÚ?$!„cšôpW+ªƒ"º§R}šƒœîEEp÷xCš”-²¬X×h¾ßæ|X¬ÓÙ\úĞ÷çĞn	£¼’gç&Wh·»)]»èñK/˜ÙÜ®¶Ëë•¬7ùc¾\Öô¸ŸË‡<™çĞ{–P-ÛV7¢—ğ#ÚkSŸ‰Ç83N­H,2Ié{ “»Ü½XÊ1>ˆ{õŞy4Ù|dF%vİˆ|Àà73È¤ã~Y:¥îÎ¤vQò,õş¾å¢Ù¼Â³šÊU˜Ï!maJ0EË\aÛ‚× zuiÃÊF@mç|2œì§»ÿ¯#Pcùé"â–6~†ÇA¸Ô>°ÜZÏ ÃWäh%”€ªå_İ5Du&°˜×’êÉ?O#¬€ôîoqn£¥CÊ£ÜqĞü)óƒxƒ*Øé§´tĞš£f5Ô^£.cÑñÚìºµ¾C˜!°›ËÌ Ë%m…eNZ¸T…ÌMd:;$ ]î• ¶ZNªâÛã›*óĞ˜@!&{ˆ\o¾¿‚_­ä>“9Ç,c’/@É™áì‰„‹/Zrf‡ıˆq÷}@|m¦zù!ıósâ"{	>J¡Mƒp"a^±í–Œ$9?ú¨¼x¯~hóü±Z¸øzU´ÜÈ‡ÈÏ\ÖáMÛ¥¦œYğ%õF—èÀ‘°rBd±^ÀhP&É´şä}{ÕsäH‰/©O ¬†®åìlAòmœÏÚÛLÌÿU–íü–%ü1>‰a|ÎÁ¥T(.–¨ØªÂI®£¥(z HÛwéM«Kj#´R·qÛÙÜ*7ŸSŸu`=j{àI¿³‰ÙöIòqô HÕ«–ìï\åJYZsh„æcCÉ÷¥Ç¼åúõ2¶·î$>6×-ËÚûÎ÷g«7…1$óq=+ªj*!‰ŞbWpf¬ºÃ«D¿5(¶³ ÿ&\˜6ÕTKª]@ìü]w	AË#@ ùQåQ”´ÕÛ6Sğ$’açÍœÎ…B2÷‹‘²tùğÆ°·ül …µÁ"<‡8ÂüíÕÀØ	§ózéd
D?FWT£Tô¬’ÏÇ7ÏIá€ÃÅá¥F®üÂÛHñ B#8]“Ü.¢Ûğkû7­K©vácL&ñÙgïí½U(!áë"¬(b›Fêı1òE}V‹ÜÁªŞˆd)ô1ßBs“QÀÅåã¸|¸Ø
©-5}:0–ÈcÌÈ ÀºO¶£îpš´„×ê×¼k4®™	–~Eyd%´ß¢›sa‚–mÎ*ÀK97å~S‹:T›1WKRöésİö9áëŸƒPêw5ªM·ƒÛû¬P*4À,ëîZ%]u ™Mñ¶‡£êÈûƒŞOçõ‡ÂØ(€‡g—#ş–$Ÿ3ÄX¥ˆÑ~çQ±rSÛ06.­"õæ xAÀÊ1dÕ%“_7Åùß«%¬c5(enÇÕ=ÑÆ|w‹.P³ÿÒàI'¬úN{‘I»/€ù¢£Âå+Îå&ğ¸ˆğyêè¤[¤\@¿»z¼Jj@×ê3NÑ¾[:AÈZÿ«òŒ@X(ä:aCßf¿ÄQŒ.‚;8Ë8àßÙ+xáŞ¸ôxê<³r¼Sœ
 õ0v®‰ı%Sà»À„êÕ‘¢ä†l@2>^ÿÅ’:ï„$-rÍ;š§"†‰k‹ÚÁi¾úî1DM¿»J÷N§h7.Âøí¿¶£Şµ™S_âùÀVjLŠ±®ÇĞ"H:Jo¨D‹áà3ÃTğ½ÇÉkÚTqoÕ^Wıkøb³tz¹}\§ºòÍ–ÛßE¡]PÁû^'±©kOz¸)É/ûv»=<*_*uôõHîËÔwéªà3o÷Y›èf`Ö„2âó»ÍĞ<•\¤± z#”aĞÌ9U¦º-ú—šV6?[p—VésJü$›Ùa…zÔkû aÆ(À 6j3qšmybm±oæW(‹œ¶1Œ¡Ã/ÓZ°Šzwñ€ˆñWÙM ×èûamVº‰… 7íu®ºØ–Ë¥ó4,ôlSq»ZéN‰yü
ÈÇAÁà4Xí‹¨çnÈÚ´mÃ;håXÜ
NM4S5øøB…¤‹zWşÓãN&Éæ¿Âåf1	âVõ[ú:¦P‘[ğf'5İµåêıÆ,¦Re<±ZSx£D “ $çÇ­i¡öe=B~9ÉN(+ÿ‡(
^ÄÓK±Âw~Õéöà*SÕ¹À–Ìyú^Æ¯=;E²oÅoCsmN°¢W{÷Hw¢ãb¨$[ëúsÍÍÜ5}V‚5ì˜3Èö	—0šÌ%’v–7dó=—ì"sÂ¡˜ì ‚XÖÀ=İéEÈlè˜2‘ÆvÇŸ”AVd·W³±g‰+ƒE¡uâˆş±†­ –ï‰÷Ğ*}Uâ¥tíWQ=?3M¨†¹Mm0­­ô^?¦£}ˆ÷PRù]°7„2]¥ÁŠOZ¨`“ Ôš¦¾SI¶•LeM=AÍĞ	2‰¸ÙÖƒÙ¢Ñ%mG9H«&ªU,¹µ2É»*;bo.fgILp©LıwŸ²@ÑJ“<%Æ9^JÇ6©»À<]wL÷FWÎçT^)+&Øå1úÕ–]¹ãFéØÔY'ØnUçq
¶K2è¶š(|Ñ¬i	.£ûğÛ¬4šÙÛôàà•ƒºr;²Oåh¼n\´ÿEÌ^šm§Y„Y’Ö·”+8ßÒVf==(|û·è±U€ªÉ(Ÿ%é$È†¢°ÊË]¹P€n¢-‹ÁY9ƒ¾C?›çQÓaÏpÙcxò<ºØaÂêµäü\¨iÃ¥l’¢|-â—sš—²ş×şªäyCG-ÑŞh–€s-ÈRğùş=?WâcÀğCŒ†‡)>P\è0ë6Ì”±/k¡c]â@v¯‘aº«9iüë/#çht!_œÍ¸Ã†”f2f¼2¸W¤¶B„CGêJÜ…ÖúgñÃÈê­y‡zC8F¢;7³¼˜7üI ›«JåÜ.@w­6K8WZùªH¦@b0F‰`;^z9²?‡şsƒJaLÄlúÃx©OËÒ©x•];ikK†µcntĞ9êtã‰±÷Á.g<%‘»©)ÆT¶Qd—>‰Òäì |v¨jçNû†y´’¢§»»¦î Çÿü)‚
,ÅÔØl˜Cµ¨!úñ²‚ƒıÀª›»»ğG;[ÕËçúRŞS±7écòkÕàÛ‹hÛÊù¹ãÇ.‹ ·Ø'„Ûh^Ì&]sHÅi“Ü-2bvä«e|ê]Úbâ€BÁBs¿±¤ W”K½ûıtw y}.Ëä·tuWô¶÷gßR¢Á_{ˆ2óP¨Â	 £}=¼ügµ‘›ÖIQ(ç#eA‰SÕ'[­Â¡ºQ„Í
òÊÔÙ¨SdäÑ|~Ø
¨ób±ww,ÑåÄP»ş$í4Ã¨àZKä4D_/™ÇøGiq.ç#:¾T£y)'^¦à»ë`IÒá6¶°ÿ?´o¤Z\¹Èb/êÙÙ¤/8 f^kõÊnÉ4Aj"ÛîD¬:>fDÊĞ Ï·ÜÚºkó¯8	ºc¢¿Íı…×‘dŸé 6}¬([‡"ÂÍ®1x‚K[w¿o£!.‘ğåQ½kyšu5wGéÙB­veÌØ,l
§4§Ğ¸h¨0„|[¢Y*½™–Ï¥>/n€çü€„.EÛèW”ŞYú=2æ©ñ>³‘úx~ß4¯kh£*XÂİá¡¥7¯¤u•¹î´şš<UùOR“e…ÏÉua5T2#ıï6TÖ®«B°åĞ!ˆÜHª¦Œ9+Ş?'±ïüœ„DœÖäĞÊ±â4/9¯‰(ölJĞ°{‹"ââ)k“µ|¸öTâƒ´-ŠæÙÉŠ5×N=ç¶ıkävšuöæîNÙØy¼ÅO•x¯İ|es;¡Öq»ÛêéÛÌ ğ­50ÍêBÂ[ŠÜM„ş“èY˜õz(ƒ±ÂplÂìHòaË˜yQ 8Á`:q`‡4 £wu±ÖµTİ†KNjÅ¥ùAÍW©XhÂ&ˆôñ³‰,€PÓ™c¨FÏÖ¢Jqi¨œŞ½s”FÌ»KÖ‘ïî"g>Rk(Ñò‚ûÅ
$jRFO£ÒôbTŠTş”Ê·\ÑO&TÍ±êÓ“Ûÿ<â
ÀÂçŒz‹ïX‚VH#±áÄN¹"ØŠb©€ÜÖà¡ytÄ;·¡7\=˜ó;vji(½'´zóäñ¥4s~¢IØå¯|T´>”·N×u^àø­f((c˜Ëà¢æ*zÂ.hC6Ï ûù'È•ËL,Ûİü†5-èâîÊ&O²C]•v—îP˜QWñ¦‘ùgTMxÔ5#:Ûoœk/=õ9´Mü\€ˆÉywê2ÊÇğ^'"Go³dûO¡XÃø‰3äË>2ÑCÌ]oß_oítW¼Œˆ,PŸ­7hËƒ¨Ü¨\­ÑJ…îıc²RT|¿>×ât±ë¨G'ÅŒ(KË#ëşh«;ÉV×_s{O|!W±ÃËA³J(	IPhŞMU1ñÚM¬ÔˆÄ5¬a«Ù q#Á'U_a}D‰j0Rç†D)IÍï_;Cğ,nÆk€¾SRsƒK×úQÍ…†¯¼À\¨°V§=ß³ÿUÈ±¢Œœ¢XvQX~Š‹:R”;Õ‚4˜ÏÕÂÛ£öh8â$òØøZÒÇ… CëõîóÏg•¥0r{ÙC&ö@‹^K–¢çGà3grò?‘Öë‡ûA*ã5PGÆÆ,æÔ7VÙ~©Ñû³[óAÖ£ó¾)TÕ9À‡o§@/N¡{<˜7L¹üQóÂL!Á¬€‰)™C ğ»mÔe8•¶V‹E"— 8;¦)h»ìÎKx+µ ûôÔÊ¨S#Ä_=:¶±(ïşx¯Cy°*U…-š0:Ù—©@NÈüÖ:œ­¡m¤Å43#Ÿü¤mºà‰O8\2ÓL…öë`‚?ÏÎ³z¶ü™ÌÅ¨J—»­_9ÖÌIÃYÉ³Şi	- $¢„•¬[¯´/à¯q¸n $½õw&Õ™‹´ŸÚÊ¹èJÓÎØD{Á«´A,÷¸›x2¨Ö•eàğ:¿íß¯
uq5¨õ÷ä+%ÒB×(JÁüèFêóÆ7EÌ	pI hn}{§&ä¿¢(ŞÇ[ô?ÏóâËhh¥ôÅUşºG²Î!æ/¢ÃpQÇ½ù0Y)NEÄ¶@
>4pÇŒmjĞƒ,u
0%JÚ.Â¤ëvRµÀW/ˆ0g<¯W‘†uÃŸ|¡±a"?øˆLGgîòqË#õÂÌÁ²	´³¢Mş˜¸h©½±%<å¼µËEãô2áÀÂæÕyŸö~0åâ5.£Pu$gZÒ N?3ŞsvõÆN~¦ô>UmDPV³F…ÿ¶±CÄe¨!^Šµcn%d\ó2ŞùY’¤:AÇÙ2ŸRPÈ+«…]Ÿ®“€¦$?Ï”¬
¦îğŒÊ¬\i'½$qm‰kÏ é¶ëÎƒŒºm5u˜?;2óbcJIı7Å3÷4‚šÍŒ&ŸÁ&l,N…©\óõÒIŸ VvA<Ùü@ÊbjJä¾Ê—.+qãHDjPrÌKÎÁVÉbÿ¿¢Ñ¬((ƒuhNªzİ¯t%[© 1­×%-ÉfÄ]Á)ÙSÚ&7\|ØQ¹w»htã¤b_Æ-Gí¡8¨zÉ•wº¯ßJ±xL„¨Ó¨°.Ğ(¥¨ÏP,õ†æo±¨ış1şÒ'ÔDŠCQtKõµù%nï±®¦†à-»¦ßD5 	j¢›UÁ—~"ÎVFOòF­MJE™³ÚúĞ z	îi
ÑcêÇTK¿¿ÄØw8¢ØtFQŠø)Ö‡qí•o½ [ëÚÇßK]ìk/"yÚØBO•»óÖkêÇ_Èæİ)¡­ ıã¤i"…Óè˜ÛânU#èS‰V šÒ‚Sçù	¨Øü“5°eäGVYŒúsG¹¿vºƒ’VÙÖ–@ş
Øõ¦•Pt˜€Ø‡Ô±‡„ôÑ›”Ÿ‰æR	J	õ‡Bí…[ô˜‚‰áÂÊº3õPK³ÎaÇè4Áó¿uXŞ&íÇ³q»Z¤41yvZÿ{qN3§Ji»„9¿£…+å5¶Sî9Û´âfÛ€‘TÙí^Sı—Ì/wxû áçŒ1Ÿ+“Ì~ ^7ù…Í’µèe†¬In¹‡‘&*©n°é	×5gµíºİßM©o}
3œW¸Õt’ şê»xI/4C}ø°àWuÎG#][%¼!¼tDÿ¨|w}\>âo›TÆZW²û~}&â­»?=!"Û©¿›ÙÆ+öV#¢â¸’ƒ+ş÷öJÍ¦3'VäÕûâÈá£;éÒÒâ:@3L/E±µZÍnÓ +èŸµœf•jM+ó¢ÕnÀa~BGk}ÍÖœ„uP¿a` şğ®/D…ÜÄóò+ÁW”ï†ˆ†¤éæîR](Šùƒße£êÈ)££_ÍÄ	``w%:Wáğ1.çSrÙ|áÓÉ¤È¶oæ¤É
Mæ‚®1ì­ÈrY½êcîmÒY‘Ü4²¥áïD}LP
ùÌ™qßàzôCšÙƒi¯¸vyxÒÄwuÒÉ?V¼ êÚbÔäc£ä‚S&Èc9’…å™éè.vÂòí%Çê?v°A'½a‰pÆZæ9şá—Ê'¿4 
;øÚÔú¶qÊÊøã™]Šı1­™o½ö®iPŠk…ŸïMXœyíYbË»–Ì M×é€y„ÀÒJÍnê{ÂR]ë^îoóú¬Bc±ûˆZ`Ì†Êã‰UL¶™²KµÒ²LÆ§ª{]TÂ²<:.¥sâœraã™Ò—ÌLãø,ZÄŞ–wí,S)lÇÊgÌ¼rr<ğÿÑÆ8ƒ”l®£ñ¡Lrx©°˜v³Œ’_b¤š’ßBN÷frĞÂ“Y%¢j‰ñ©T5 Àòä²¬V¾&tIVµúæ¼+ÈhøÕ²±9jÍZıQˆNxì€§Tÿü7¶çz3(ínNLŒ`­,1@%«óåòª£]İÛ5şğˆµc–‘LñÌÄÓ‹QwÂˆ°JHn¬%G<³«sf˜TÍ\‰îõ³ bEô+¥¯l§QÂH¨ù”¶Ìâ&_£Ó&ö£„üÑr6ƒj<cø¹Œ}-=^8¹XO»jˆ§‹‘«Æ ÎÍÊ‡ÃMˆ4ò	°W!ûæ~gç˜İó{R·jj-Rá¸O_ñ& rÂøş¯ê÷?Ñ<±ï°”`–<k7Hx2Ä–nÏj“’û”é,`ÅpX»n.³m/ÄÆ‰@–‘rÄ>Ñ¨Æ ¸^†/€>òÖ}¯Å‘Lù­é/ÔxÚy]$¾/×XN¢XgşQs„ÕÉŒçæÍˆ%,Jk—fëØ²âÅİ;§HOøÅ5”ñÁ«"yÍé$åúc‰Ä’…]¦ËíEûû¢^íløl8AS‹qÒ7y€÷Y.GRÊÍÈoiı9ï&“öà›JIN+€t ŞPù{TŞvc­EO ÅxÎlÇùŸªòStÍß½‹¨d¿ƒÈ+9i ƒ}bNàQs4G ½ƒºM'7vo9¦Ş¤¶„¦™º4$Q€.¦Ê=òcü³ÇÄé`Ğ4«Íê¾…lá	˜è!\<#×æpÏc2ÑÇeÊ2®e¦>ú¢ÙTçşØŒ¾´‰d¼™Ôú¤¯—uk®¼î‚gÖHKĞo8Š'V¹|lÖ<½½ …íûvøKÙµóHf&Ííÿœ»Õ±QR.@<Â6NC‡Z#–E•tŠ‚&µÜ=õj‘Aãû6òñ»u`s~{¶QTÃG»¢À÷ØÍÜøôOCærJÁaR~AÔ0‘Œb³ø³Õ}#dBC­†v>Ry™†Fñl`êJ3î™Ÿî%Ú¾*b;ªâ.÷k×P™If0UÂå0Úhœ£êF«¢’Ë|ÌúŸ©ÓÏ'ÄĞªzâDãúì(ä‡:§—´–Y‹d®eÃnËwÉ6|4oHÜe"†êdÿG‹;FT(Ü=Õê¨™®êÔ%k18·WqälB—|)U tı©®“Õ×èÍwQ¼´Rï_ÙãM×ºŠ«hjš€®ow4>@oº=XñkØöƒhµ&.àş#™V"4UÚ9uûh¸&‘Ä8zÓ¦yı³/œyĞ¬i(¶1Ü	¢M!x°Q¤>õğo.{±â»:Ôbu»Vü¨#"Ùÿ?WÛ¤C[¯A¼wLQ0áiF€Âç…Iñ”ÿ^ª;Ğ½2$•4–ÅîÕ™üÊ’+µ«!Ph«aX½dõTæŸ©]!¶ªwË¡ğ{º¶üdu¦× ÷KÅ<%[eğ-üG¦Ú™¼‡’¦ıõƒ÷´Uº…|¦é´U|¿‚$#Tœ·™3:Š]
¹´‰cNF¤i¯fnî…¿R¢ÒFô•¹]®±˜WêAºtâ÷ˆÓmn­¼€©ì¡q­ÉµÖpÚ#qö«èÜv\V»vÀ¿ÒVëºQeÖ˜ã}b-_/ß¯6ùááŠäsn±7ùw·«"×¯ı5fÈ—CPwô¢dö	±‰Éõ,¿‰Û—ª98R»ŒÂí¾ôÕOmòjy#	mËÊS
6Cqnç™5U¼ÚhÍ Eµni\jhqñ¢Ê‰:ÕÙõ+S‘–ÂbeL ùÉ‡ßkD—?®¶ŞÊ}¼Àšaumˆ´ñõ4àwåZm}©ê˜Àä‹×P¤.
İ¥h?wS‹M`È„*¦ÛcÑ²yáÅL«£‰ÌAaœò‚·(»D“k³ÓÂyu–kJgY7a¢08À±gJ©ÓT\IÌ*ÙâÅƒÂ„óŒæp…r€úÍ*È[I¿ÌlÇx ‰nÈËÈßğmAC†Û9Ì…ù,Î5dÔ·›Â“õÎòš¾ûËÜ„"8şxÂË£–TÀÖY YB‘Ä§úd·¥ÊS—¤7)a×&§G( ĞcsŞú‚>TºÚj7„â“ŸvÓ,=î.ü0¼ÑÛ'~î&§FºÀ˜äµ'–p˜¶¬€Ä¼“¶L£0p¥Â§HfeÄyì9ÌG¡hÇd×!lSËÙt|¬ĞªÔ1î”¼¬By^gÖå.)c!v“î¿¢Ì¹8¬/‹ßHû›#g>^G-tòêoS£ŒgQ× }xiÅ{úM®T['ÏgC×‰¬•·åZ}³ãœ!Uy¥Dl8–›"ò¿—±¨³å<UÕ‡Lö\âB¾âîTz®G~ûÚä™,Ñæ‚—&^«ÆûÇµÈÇµêí²´ªËoN9Z²@¦,a{ØÃqdÿ­Msc),dşÈ?ƒÅÄK9`ê$x»[CÙ·uğ€p8Ç«Ùs«VÉ¢¬z‚9¶„¹”šÄîwÒUù2*ÃQ¬­mñíXô¾óŸ™öDD0çÇàßrş ZÜÆî®FTR4®¯`ƒò±àò_O¥ĞLaãııª™ıÖëlgÙ=^S–ÀH‘­oı³”l-ÇÉRì¨/Øáßàß1ÀÔH;oÃxN¢ºré­ıqÓ³^lÏ¢IÏî1¨³æÜ>-Õ1”ãAß¤`øÖ¸ııÍÈ¿taËs‰M?#aº‹³w:å8‹`é³³5v=y€^mâ9ySşb	gæ¦t1lj²¯’Ä‹òqi¢™’şRÛLeî¬ÙYCU…‡tmòcüSÂ! ê¹AH»§Wi¼'­›râş¡Î*ïcíòøãƒ–ü©Î_(ÌñP"9®”†ßÎdÔÏîùÕùo¼š{Tm‹ï¼I&czßª1ä/Âè^ ÊG¿¡'"\IóZ27N ”kN6İKTvä€šØÂ\ó”ÊÚ(xhÇ¿âmÌhC]2	4×9éÍóJJô˜øVU­Ü”ïÇcZ\iè6—fã"ĞrØ”š %¼|ÜiqŞ[Æ
$œ– {ÓÀ)^¸À„ØtŸ˜1´—¾ÛºcZë¶c
/×¤EmJ¨dÑT¤ÎÊ™@Dî½Ï"º»äßş¾FÓ
LEMÚ0´æ¢—(Ê„5àz(èR	†Ixø–s‰ŒÙ“ú,­©e{Çüû.Îı“eK¹µà‹Ÿ1)µe_»gP¹å1JÈE§økÊ=È¡|,®»Øˆ
Àsp)GÁ(Qÿ‰nup;²hµˆûl›.Ú/âÀy¼Tm ‘3¦‰çñnıĞgP ôŠÉt§5<_¾îØ?g÷¡§$ú«İ–¶|7Yî[y£ã˜dĞı€}¯ªVàx"B4©¹6Ææã€fÚQìßÂ.œ^gõ‡iÂ‹[­°6™.“Un'#Bæ”ü¤Ê
`9¡Pˆ¸	ØínmÈsp§«jFİ¼°cÒüzK[záàI#@fÓ+
»ÃXD¨ËBv+$.óñlÁ^	ßCİĞ†øáAîVú›Î:¸’äbl3Œ‚|âİ‡Ğos€DÖÜºî&£N/¾ÉX<”I3È²ì|ÄíÃ¯	•;Ñº|H‹ ø¨ÎéÅú¹5Ô‘^×Õ±aâ…¶òDù]FÚK]À=v_rv¥“`ÏRû§ƒQUvş|ÍÖf3§q
æè«“€Ô6>Pê§Mn~€Õqñ'C6´
°6ë-toŒPŸäRáÿg•»©QK‰§„*rê06¤–üö0Ï–>)•—ošŞÈó{üŸI•f„»ÓıAQ·ãvXjÔá_ó -ÿ|iJfìù|wàµHòHuDŠok"i)8Ö{ñu´±ĞTtõÖc®É#—=Bâ}\€Ö€Ü¸ÃİÂŠWïg‚ÓW˜}¢À2®}%¢WL ‡f+Š–à·ƒ0£cæY!f¹6¬)
ÓŒƒ3YD‰Ã¨²iÑ"eášÍåáÁMn+ ìh‡Â­»õ`Ä‚>‡gú>Ö5½fpV¨ºØjS¢µì%'Ì˜Óñ
œüeÓÄ&¨Ñí9Ëò]í·#UÉÓ37ñ‚wV”ˆmÃî8]”ÁÔ_gÿOC“øßÃA4/¹¸
;hû	ã^4¥hÖrÃ‡}b’R¸£ßNÅù{Í9j84äû èâoûæn¡ôßg+Üû£5õÌÈ”‚…œÄ[¢m¿[íKå©¦à%¼n°j"Rä$Œ d„ÔOª¯ù8IÇ(tûb@²,ß¬ãAKP±oÁTÓæpH5«S×§ÀıòâS%"ÑM-)¯Å¸ûÇ#q0†‡¶W¸ÉßRHCÛ×uœH&|F mÒi§] ¯ùµŠ™”h€å‡L,#¿€å¾ıù³‰á·œ9PÒÅy<24™p'…Œb©2aô×«	Ô;¡íß¾2úµ‹~´qs‡>¡}6¼3wO&ƒ?F©òåîÛÌW@»±q÷ç¡XLš¾İ?¬cŸì*ÉÂğJzwBºÅPşt€~"ü&5hÃÅZnW”REy3lÛ±X²?ñÈõ«jÁDñ 4&Â­,ñ"ŞWÔQeQ \«…Î1»?•5úZE—´şŞ\İuØ5wĞÿàÌø7ÃeíbÅÃ|[n,°Àv¨¤-u¼³zÄı©xç9Òm!TOEŠ"¥MFSskàA—›^ü<µîQk3ÕÚß«n¿Ë=ƒØ±m™VÂæşáCÒiìÆ’»çöÃ¿òÊ›÷ú;Î]ßIšÕoîÜÙ6Çêè<`Õ‚£QH”ÀÃ÷÷ŠĞĞKo¯$údã-âóR,„5qm€×šAíñµ.Ö„BCağğI–-SG$#-W‰‡Zl%ç»å;cÎ–Ûºû?Æ½åYÊúƒ•>ÌŒNÀ®®L#öùÙs¶M$Ã;e	ó‹Êğ›p˜ppw
Ko¬
»şB±Sr&!ëÔüsÖj>~¦»¤B ‘ûg®èzf1JË‘uRU™Ş$¡<k»iÛ'œ˜Oo^ê'„´‰#înÓ|–oÀXŸ ‹›]Û4“:Ò]ÏŒŞR±E4ó¥q s ÂtÉÆ_¨¤Kœ!¾k¨*:óIã^¦+2ş-E9Âò¸İQÃ€ÍEfûHŒÁ®‹(öB6ñútPa«R¯¾ÆdÌ}ÿî¬¸%"šçÆĞ¾©AFà4áİQ× ÚˆPSÓJªsó´OQqh5|õkC§]œ"æcAe2›³üZèI¾Ëåcjóy=ˆüXv ìÀD˜ÙÓ]ø©Ê¹X­Ïˆ=¼æÂ'GvÜR#VÖ}åÅ¤ûCÂ`ŒÄ7l3àQªü€úCò}<ÉÂh­“hó?b±o|cãÁœÂ²h=B°Û³…\ÜZÇ•¬·ã¤˜¸MÍëAM¨Î5Yÿ4asT¾!át—zúË}oò±ÃÜÀ‚-< gÁ(?»ÅÛFí½cİÖ3§Ù
°r+ ÜR'*‰¶:÷8¥Æ)¶|8E¤¬ñ*{XNë…)%(x”O×U~´oÚsñWàÆ†h>­¶˜•,Ú¤eñÍŠ°¦÷ßAFñ–-ı‹İÑ|»YcòñÜºíŞ=İ¤	íÒ”ºU†¬Á —¤__ªh>gLQÊ±Fuß!FÉùä25ÿn@A³W<,\Xë·gr/ùhøDúœ),ó©ÊX|ì^àÍ•É7­!Û'&Âæ_”Á]×^NL%vôx¾)yÏûdœòõÙ4è$–à0BğHev5‹c,ú«ç¥dö>K´ïLl$xì«šêSå®&k¾:šèˆw_ˆIs¬œôÛ§âÓ³êõJÆØ÷w4ëˆ3ÖÚì:À*ãøì=Ë
¸è=¯}yåc1Öoš2ñšOøî<®òdM¶Î9Ë[¤æi|‹{_rÂˆ¨m6ÕÖI¶›ëcÓßg¹N·[£pi9¨Sš€4ış/e(¾‹%ET¨’QòuÙÍİê.oVİèf§qt€º4U=É®áJ×½Ò1¥"­€Úß.ˆä“9ùNWGA[Pê¿é}{è;a>¬*¯Z¸×, #9‡‚o˜.p˜	#ö30#¢-·;F‡G$</:É$DÀ=&ÍišÕs9€w°î´{²ë>K_+8Ó¸ìÖNH7Fui¦Nt.ãÔ>NÖ±‚Š•M¢ú0œ
%‚ÔÁyn)c…¹6†¯ë
m¤˜cÉ3İ™ùr†€PM¤û®¡XêôRa7‡ÙPû§‘‚!?®J^©–à«SÜéÔ®$ßSÿ[xñ´bnÖRa¦~…q(‘f»ßËì„/*øTï!<Êã$5ÈNã2Ì6®œEÕ,Û…™ÉØf0›Î•FI;ÎÄ1LÑP”´t ü¼ä0íMÕ~0n{k‰:\Ú ºĞ7ƒp€ì»9ÂÇ,__¹°ƒKaÚsy»ºM}/=0¼›6qéi¬{QÚ#Êr÷ƒ¹¹G_5RÃ¿c`2|¾[Ñ‡-ÎOˆ-düŸ”pV_˜£‘.C{Lø#x¡ »C`hjØ¨A›º´¤2Éd†çn¼·K$ƒ“fC–âŞztGR|E—Ò¼˜èş­5™+VsçU¦pI¸ù‡Åïti´È-Ôóƒî»lñÓªæ=ß~d¤2B1gObcÚÀË€hëıUrĞ÷µtì¼¡Q¢^ú91¢™£1I² ?, Ô{/Í´WìĞ|İ·€«HèlKª)Y†kúŞéÉ zİ!0BâØQA¯ßÈ„Lˆj`[ÖõœkCŞR†~ój%0o‰â×øçö–—ˆçq3ÉÂˆj$ó§™È;q:¶ãßÆ­ÎË ¬ªr`Ô-¹.'ãis›*¾÷z3¶h$"ºI£Ù°×Ñ¿8W>N~¬
ÖÅ¶X9?ÿHĞ‡ê%&E(WWbcB=HÅ¦–ğqŸ2Jù§NEmÛš‹ªW_È=¼ßÔ7Ë·â§ŒøX &in(Aƒ¢ÎÛı³šÈã«y‹z´îÎ»¾Z„u‰qËcû<¹¶_Ú©¿ºyÅ¡€Ã¬£zPH©5€ m‘§ 9ø>è5ÌÅe1°jWh=¬¶0H—|¶mc&Z“Ù5mcÊéqÖÂ‘	ï—ÌûÌ:ã0ĞÿnÀvÜ*MùŞ¬pdVR%†ê
j§tC/A
»Ïìòˆ÷f»ë3:îhej³Ó¸Wı&8 ~¶§~yxãs×eP|)¡Óş)œXG·UŠÂê:P4ë½GËâ6§('âÜIÔ¾İQKÖNDË­·@7â‹ÜÅ!ÑbŞl?ü%Ü
Ÿ<`ß@²]ÔåëGuùÃ—Ş—VgÎ–éy¨’¥'e­¯ÖFl¯r!ÿä§yX÷Ï•ì(ø£Ú´üDş4ëİá÷ŞtŠE‡-]4OÌ*ìÒŸ×e%R ¸ps`PÍ$®	oùE˜ „-£Ra|Ã8é“§ó'÷––Y) ¦©z‹à®VŒ”;âU^0Û<+¯®™@dY­ß§jQîV(¿# §³ì [Àäá¡nŒ¢¾5|ifE>İbééí¯s®CÁ­è|ø%X¼ˆç’ZeNÍX€€ñbf\¦à¨âİÁ~Cò—Kı`ç‰íì½“k"GqOË¸äìÿ­Ñ{Dü©[Xß&|úkv–HòA£2/”ïÉtO%ÇqÓd«_=àÂ4œ,Ø‘ÜS°cõ8l[eõ y‚!]+œ³ïqú›2HÏšĞ€)¶½±ç¥¨üCéÓÓr¤ãÛ\Aœİój×µ	‰	Á8Ûì·RÑ2ğs¤R¡aÏ4Y>“¯ïKû$ıÎQ*Ê9&ä¨B­˜ö otHmNeÍmÒPü'®5¨VP#Më‡ÚÀ'c‰”&,:CËuÖyİ‰•!Í’Bó6Z§%®î|)`&mC;Ş?¢‚ná¯pQ+09[ëvXÔ5RÓı^¦Ğ2Ö‰w°MNQÚ–HB¥ñ¿Î£´Ò¦û…Ñ»ÿ‚}ò_Ô~ó#‘åâÆSâ­U
.mø[……&wKXAIuÙ6ıÏuQ!ñ)Sd¡ßşhE·äK–)¸pO{\!ıXlñÀ•-ˆ´±Ù¥¦›dÀr¬1i xoÁ}Ó,rá‹÷v}°üïÓCŞ$Ct²;ğù/ô½µ'?r>úÊ˜ú#¹úmœ~],­X/€9rVò1ëb.Šêƒn~ñÃ0\#ø’Le_v#ïa~’'À®)Ìƒhô³­ø$˜[q¦Oá×ò7‚RNRìû‚eëP»*¸­+*ÚşÅÿÊµ)k¸;´Ÿ­L>â¬µÙ#Sd XÆ¤ÙaÓÇ›ñåõ\+”¦ÉVóN86éˆÛSÌÀğ›™höşüZî¾8åoî¹¡LTÛÄüYáãğşTp¦D®³ZL€1-ŒôÙ¥~Ç
f¨Qhv<Ë
ö–û_€¨Óê-™
³ûµIOiõçŞ•íŠãºU>ì²ŠÑGÜ“.Ôè
¹)á7×Â*ˆr½Nó³êıô<rWÊ>IÌ“§È·Råêf~À™ª!šœÒµ¹ÑKP,ÿ.sS‹åAcR{½÷H
İgïb~½‹‰ÊĞ¾¶%­J{¬³¡Å‘ä§î6Ø±XÍèš>¹U9h·‡Æ´TÍ=ææbéìù××áa,œaõ±f"Y‰²’FÒ/RôXèj|¶c#‹é t¥½¼·uiBY¦õûúRÁ(olDy`L[¡.‰wcû +ÂŠôŠy	÷Ñÿ·cü‰ód×Ës0zÈ½Wš-:­	w·¨+A`lb)OVí;Ê©Œ6!…c)±sš8v24½¶s×S{‹ÊnEŸ%vıè“Ÿ!*ª€!ªÆ/üÚÓíäÔ~ Ï¢>¡ouæß™Ç±%¦Ä¿,†t™ûE2Z$ã_N?¹ T÷™_aæüikî£J:q•:-„XTp mA°Ö_š ´3S0ÒĞªsÍäP[GÇI}oÍæÒÙ:ÚåÙŸMlGÎdÙñÑ’öDĞÕ§é·ı´Ùw³wa,Òª@µqî%åÛJ";sud¼Á›.æ€…¯¥.Àú‡?†UO`±šİŸúV`„¨Z”ù­U)›¬®*‡IØÓƒ?kÙ,4c]Sc€&şKú$ƒÉäMû/Èúé7ò´BßëyŠodôH’İ8£Ow»ú/íÎ–Ìß#û~K®
Û]âÔÇG´Jßvdñu“6ş/SúÆ‹SWvåı¶%˜°Ñ\wR3Ÿšgu^ê`-ª}LÁmHÒ«şÕa7ÚÑUVºB^‘)»v£©‡I#äÎ:éĞ„–©ÆÍ}€n'Š‹c`hô[ß‹<'8_šªpÍmÙ×ü\d ïW.ş¿Öã»XXÒÕúºø¸.:XO SïlkPG7=jYC¯ì€A€_Ú@)‡Ÿ£&k]¿¾-dWbİß¹°GP‹¥À¡3ş@Ÿæ©À.x¯Ó¤%®É±»1_ÊC? $·P¯#BÎ™µvSiCƒòNU¤_Fgƒ–"¤|}¾W kŸ:u‰¡Áv>Xl†‘g÷¯C_ßúhÿ¨ÕNÀ‚ùÓ‡‚Î2¯STkSäÄÊìÿñÅ0E,óè=e0ƒxe#‰¤ïR.@çıUuT¼ î1’\¸ŸÃ)cÙAPlÀìõ™>Óƒ-ĞÅŞIøõÒ-<-–2¼—fÑ«-ËNô
5­ë(1]#~õ<Ñ	£5ĞÄ,ğÍÔ‹àWƒèÂ*Ö4^lA>¶7TmÉ¾°ÇkºrÑõƒ&ƒ‰Yc)o­ÕV…§×kLı KÓ êˆ
{G%½tç‹2 Õâü%îÑcø·
i÷Å¨kÈ¬Y¤9òÎ¸ÁVØ§µÓaÀ`yßëòe²c,î¯V{îtïÊÙ›Ê€™dKTø5ßŸ®õDOãoòmË*˜¡±5w¨¡³Å`!°ş·•«Eµ.ñÂøM”* "9îß"±	öŞ_µpšYŒ³Â7O•« üö{˜6Ç¥48ö§(s$îi]|¶y{rê6#2 Bê@HGÊ(ì¬5]ö“œCtVİë·;fÖaåùÍöËÁĞà,n˜ÊÎõœÃ}"b±œfõ,7¸ŒW	BÂ°›@% î¸0aÂaİøš‡Áˆ¶“/á=§ê÷ÑçòêT£vıôw¶hÀû\ßVúÆ¬D4€”	]€âÙpÀôÌ <¹AŒ©ãœÅ|ëÏÆ-©J/Xë™V‹šµŞ’Õ`(£$YõãòG		ºßjçêÁ!°9DŞ‡€Àü~7â€ğÄ1!Z´çEoK¼_î·;èëx–Ÿ÷üåR¢æ•E´Ö³È×œÒd½pıæh¸©µÈÈA^=4€†©dc2”FNiû'\š¾"èí8õ61î&€ò%A!}5å5 ;Æàê–ú[n!Pğ‡óóÕÄ_Ê±›³Tà¶zç(4É¢îû	Qs¹Z³:ù'ş/=Î"1^Üï–úWˆ?$Œ7°Ş: å‰{/ğ˜‚Cd #$ÿjœ Tˆî[ğ¯‚æ_%ÚŠÖ6ßàûLç”6A4à)ä·¥œétşÿûou ÑpŠv9÷£†Áå“lÖUG÷ßfüòêË™nÍ-_p3ŠÜm OdiÔ5 ±™hòËnPè b§—Hµ«È,­”LûƒÇ¸ÎtpÔ8L–JØãİó>aÓ™‚%;ŒÖ/¿ÆÒeÓäF³Şâq2‚»ÔË†IÌs°/~²¦€åİ‰$ñi$€%#WütâÑ91_^2§ĞCp]ü²THõdñnôJş6„œgZñ‰}K@ç0âõ0›+¥“ø ²X·Pø––†.Q+>ùW°\ú_|{Ü‰…`5ÈÏÃXåsÖÆ²J„úò…ÂÏş¥Ówbın)ÙÈ3,“¬cèzBpE²ÇóOähí„Â7W4È'†Z¼yeZßhBÒ ›s°‘[†ê’UÂÔ§{~‡77dcˆé"üşñ˜‰]ô2Úb˜¹ñX:<M<ˆà-€øßš1ìZç(½e‚”ö™q8·*ğ&±Áˆ.æ­%s
T†B§O0_—è‚‰éŸÖ^ûÔ´ÅZT[Ò*ÃÆML¼¦æ+*Î6şûÿT³0'âS$8vŠO¯O¥ŸI•³ßã…€ÌõÍõäp^&ğmLì‚·Y²æziŠMK³1|t‹ª‚WhoİªfpR÷Ö©˜"ÊAĞûôÍf¢îÏ[}wÕs‡4ª”#ûC1ó^£€Ñø7Ø…¸?u²µv
c9'ãDˆ.IµØ`ĞÈè:5°…|»æ» ÿ<±ÉZĞ/c¦zßR°~,ºŞ*àJg¦Œ	³Ùğ‡šd:›#êéX¸,qLwyÅùD/ÙS™—ğ]ÛáFğ+SxfĞ¼ÛFŒQ] p‹/´·ôÛRº6ı¤	7:MÙp»4D³Ê<ë]óT8»!åÓ•oän˜ª³¶ÚÃ"½ÿıQ}‚!„²ñÃ7íOU¦†&·¢ú{)iRM7ª|E§Ñt"ĞÇ#¤k¥¤´q*h$­$/RÄR‹À¿"MN{ÚŒ¼	êœ»Ïàwš ³¤jğn²'ôhRßğ¡™¼æg»`Úa»—ám«Âş‡9«şPY3{P¯%¹È¸Rûÿ†É†~hNh©³ÉZ²Éï{0¦ÚYyç?	Şé¸½|ÿ/ëˆPñLV0Rj<må1P=«%àÂoÆ!"cà™Ö,'+–€•n0Ó;¥8ş†q³•×…{â2Âá«ÿmğ@Tü¨¶Tã6|ö·X/ÉväÊğÿ”©îÁòÔñu5…²·‹7W®Èp)çÉìoöªú1¨"‡î&Lâ¯Ì{ õË¢ué³wîş¼¦dËİK/û8>’İ;ÖåoXBÂ—Ğİ	n,Teh.&ñ–@>¥<ur³hèÎĞ‡Òrèív>WmY©ã,S6¢ßB"Däî5şˆ‚2“S´Ñ$Ü¨‚¾3É¢¯ş 6Ãµê²G'V2§¹×HÇ öUºTª+…êÙ	0½8ÍæÊ†ÓPË‡mHg_à\¸mAûÚ' ŒØ!=¬âµı|ğMH©îR¾†áŒ3ş^g×·—äA{yŸ-¾»·Zu00&åzîWFÍ(wú?àkaOˆÙ’K#‚¸¶r¸´b]-qVÒ“…P³&‚µ°*éÑ»¶,dLû†²å8$Ü"İßaÿĞÊ&¥­æ]áfVù*?%Ü%B‘ĞìÍ¬µS,¨Œ´@e¶[ù ÈB#FR­‰'ø·ù¿ëœìªa"˜¥Ãß€ôîÁç3 •Y:j¡Á´8­!ËRÛi\,$';B*@}×!€ÆÌ”ãy .F#5š/¢·Ã%?JÚ×j|I
ECî;ˆ×šˆÌ'ƒ"	Ûf”»«Sœr_FÓÍŞÄÿ†ŠaïMd™ãæŠ8õ.gÿnì\½“QÉ^ZypÀü‡‡PtCrÚ‹¯Ò³6éÍ mšHQÀÑõ­ˆÒg"p/bl„jŞs
DÕÙ×9B-û*cí”—gëæR°gç.Ë]ñ?qÛW«â(«´ÆÆ°›“õÚ…5FÜ¥–gm‹Ò¸ÎæÅ=óêÌº×ÂÙ¥$±ğQëe¡9´	ys*áNZŞšÙäòAˆ¬lç«ü¬›Lu¹»¶'üMàîá.bl»«+Ä¸J£Y`k#†(4c¨ì,ÎâJÚmZlà0PÙ%¬æ»¾K³6kßyPä_#]¡23BE€®Ü|n•¾©"Ïö'xÃãy…	Öz†„W'7T·«	ÁqÛ¶•S‚œ^ÊÔ0ˆºÓ—[.ƒS1Œyõ'3—â°XÔbt»^9ô*Ä8ØšùˆâÌ.¸Û§#!‰yÿ«ÑĞšÀSÅ+`üñ˜İˆ(®„~
wFÔ
YãH­İ‡wµU¯÷#ÎrUî9·, xÿS¶ú†»¢B¾Á>õMMÜ.Áyš²N‹»dD9ÌÆoáJÍÌ¶r?kÁ›î¶sßËùtipì+	 ü¸F¢ªª¶xÂ,ÃAíÉŞ]kg1)³%gQÛ*XP`{Œİv@N…¿•]H”ƒõãÅ¨œé·ñ4‹ÇrNLpÏÎ´¥F°®,Rµ÷ÌÚ`v@áæşìobùòCeBcÀ6Ù$’~¢ÁK§n=‡Y‘.ÕDEÓ¾EÁÄ“kºô­û5Á*fÆ ¹«C#:‰¤”®e/‡çá®ç³©­{¥hªÀ´wˆ'µŠ¢÷}uİdAæR.pÆıIè@Çï$®¹IçÍñ.ù€é:,›hÔU‡˜¯Ã97é $Ç'‰lşˆõ°w"<íçš"ı+‡íƒ¿y%Ä¸BlŒ<ø÷0ïø3å ?—1—tÛèİy(¡ıé?	˜’áV8¨âh¶.¢QŸ]!°æ4ÆD5kZh$ú
¢HàpFğ\xé¼ÓÛœû_æ€¶2İá „h½
¢[æowıßá{¶7áñ—|õ(ÏÔÕ²ŸFıÕgæâ	ñİXù?‚•VÒlÉ³iÑÕœ’}ÿ=æ8w±²/MT"+~n©û¿<F­¬ÄˆíoA¢•Í(•9È˜Õ%'ÊĞ{=2cJ®Wò9”µO¬Üşô8í¸´N:œ”ì@°’ÁûMÂµ¹ZŒ„6?îß!ø4ÃÀ,¼&Ì-)ò#1ØÆIŠo©è:ßó_Íß{»É¬ÁÒ®Ë”(|OÎ©½Aæ|›
TØVÌŞëèşh,ß¢ÃàdÁBÈ¯>ï/D¸j-<ÑÌQUX‚Ö4@-²Äj½í€V‡ñq&55,Í¶9iULQ¯|½÷%‹`ÓÒ]Q)É	¦zÆ#ˆx±1ê¶³ç+EÁÉ8ÆÌueòV¼>¹mqîk[˜&lºÀ‘¤ lusĞZ‰_İ\º‘ï§°gJÕ]_Ûà !d|
ï¿²ıÃ¿ˆ†HG®ŒœÁ¬9•f]­¬aÆ¼+—¥hÎÄÎøzıF„
ÕfH¿cõ¡°F)M.=ŒÒtÈ‡B+xV8Çø›TéDÍÊNÿÃkä6Òçj5A8Nªu]­[ü°>²Fk-m‹MÏ·'Æ¬ÈÆXcĞí2Õ“ÊN$Ÿ!u÷4Ù€R»eRîA²HN‹è¥A•xîHì0GÙËİ\êc´Ê+4¦Ôe1ËğWÌÏÉèw˜.
cf œOÀ?]¿sóÌ+ó<û9Ê­+k±Ğˆ‡;¨Âş†h¤B‰€æˆvÕ‡BÄ<øñÆ½g>Êú#„ß¼õıŠÄt
“hĞùk·¸Ğÿ®1	ÁEâCk]%J+òXkX=]BE“Ò5ÇWN-0Ë‡3$ü|=¾øJ÷X•Œ6ÛƒÑ\Ì¯×|	Ãh£lÄsÓÎª<›¥¥%ÅÃö2
óbªTËafREÆüMÖ%DGísNe¡O5÷>¬‹Fd±Ş‚é†ş{<o(µ|-ª T¬z¡\äşkg•íñ’.]Åˆ£+Cw0ş¨ôm¹¤Z wA,v¹K¹%Y…òĞˆŞÛFmúïp•vgvIòö#‡Lˆw	”eğõQ¹g-m?Uj7gy”â•i “%éGËùÜË$˜$ödíQ%ŠğŞ
Í£®Ö]§Š'!%0V~yw/~ÜU-—ªØA…mˆHm/ca ¨"o§“õ§KÀKOØ­B/!sºîƒËvÚóCĞŠ¥ù•µö2ğ~=[&ÌG°±¸ASå
:C´Ã¸7çkóo¾Ğ”ÀƒÑï•ú{•$áëLÚ§Wc†pÂ˜æÉœêıƒ)ÜòçÊö9h:ëßòö×¥+H‹ É’mï|ÂfQ(Ò%‰ÿÕçÁ¿ìıg!İ/øšŒ‹]Q—)b•ÏR&äØ¬Ôöº÷eŠ³¾0o?‹X6K4—¯ÀxÍñ«¹‚w ×q9 jcÆÜ]š(²nŒ4‰¬éä¯€dù—ÒÖİïf&^9¸ßgÕÌœmB|4ıå<ûL ù}{‰HòÅğ¤ßø7}¥L®Ø¸JèTs–^–•‚'ø³÷ë'q('D†±BX\EŒ_a7›ZSÉ`úèƒt°ä?úş ÜÛä•D“}XA‹·ïXãê<9&æ±œ.–´dø‘^¬í×ùêGBWÀ÷¨×[Ô4¿i¼!sßIĞªí@ß}n(˜°JÆ0»'‹Ù¹Ì’ßCzôö k²ûz¡wç¥Ê¯B4ø£OŠòRP JŞ†hméQ6¿ãl9î&lD&’>ëÚ†aS7İÜIÀPHAµğ¼œ'a«q„ZöÙC\#7Q‚< ³À˜2Á[†`ÅõçÑO‚é{RÒşŸ5¸”¶h­Vhñ¿‡AO@ñ‘]ÍeÅ9‰Y-ˆì—?XÓ,¹ô¡4¢ĞÉVÒøM¸»Yd.‰=­@ Ä•¸ÌHñzçÿTn×Ì•©hG° Ú
”	Oè°2´JÄøyM6
.=dğ­/²‚XŒj95ªXF
¯]$¥ÜèMd¿2în¼Y][ğ áBá©ÈC Ğ=(K‰¨¤‘ÈÎ]ó1äzd¼~	>ô*tƒhÕ3H+š¢hv!µma}= ¯şúP:‡é¦pw/m®1b6["Ğó‰´é¯¤@—®š®kğÑ,¶ÌMõ:ôH¦‘Æ±;p³bn‹_ê™Ta!%IO»ıÖ?w41.õ<ß6A>Ñ¥ÀJ-LwÏIÏL€)ıv8/—3P3T4H_nĞ9ù"²\³­XûŸ±]¥BXb0¾¦àäRa´y÷XŞäÆ\Dh¦"Û¢¿TPÄ‚S‚AãœL®Xª²à}î¸'aåE±Âºªê½fîº±4¼Âƒy·eÆXömª$£Ê·wŞ›€ş$ò™T#dßc§Yƒ.9_K+Bİ#åbÕí:áş(Î„é¸²=å÷Â·ÕX„rrĞ%‰$E{ÂûUoi4õ=lkÙá‰vi™ÊÅ‘}Ñ;å¥3Â?–ÇÂÏ—„–a”‘Ÿäek8í€7•+Im¬­Â„Ì3é¨$sÇl¹ŒÔ‘M¡¿å»r÷iW<ş¦kËŞÌzëMAdÀ{‚ ÿ‡ı9Aæ…²^-¾ª~ÍàS†`öqDMúöˆÌoÁ¿cÕ
d
B]Â07ğ#Ş’š†¯â¿DöB€ì¨2“Çq’	ÎäĞâH§÷|Êdx/j$ù3Ø&Rôªqepÿ²kÅc?Bn¼DÎ]åª»Ğ³¡/~ºãMPâ\‘†İöO×aIÑr CTÚë»:(ù€)r÷œó7-4ÔI	®e*Ç÷Š…ğØ«BJØœ¬AçZuûG®uÑó&i£Ü7Ò	‡QÍf†¶¶nS™ßÕ#T8,zi7;~nû™)úG	&X\ä4õÃÂ}ş¸rm­i†ışî#%¡ã_M/¼¿ø
lOáüÙ¾ékWà{c©€µ.€›S‘tš„uók'ãjÒ7áº#ZèSW™OÚF¸2<h@cŸ»ÊjÉÑ*[³=(ñæ«'ËvWÜËyRëâtf<jvFı°›¡ƒİ-U„ÿ/!æÖæ•ƒ@¬Ç·Nò^ú5Tß•åìØ¡P¯¸!3ÑÎñĞöNGÂéNÂÅ\$^Vˆ&áËë)]ÇIòV÷Âì]+¥ W¸•‚›_*OŒyòLV
½ƒn«"dmsğÿkjœ#Æ¼ôÚ#(ßBLIàªçâÕEjQv½©„!Mu‰°ÓÛ<~KÃmÔ“u_¿HËËwke½ƒ¤‚8¿§±3Tv'_û£N$éÕRié;a€œ­iÙNÅRYB.‹è6üšu1~›áuzã®hæ>aÅÖŒ,ê(ÈQ}¬3x·ˆoQkÎåÿ÷6NíWò£ÛÜt"caLÈ M€r‘Ít´‚,İ7®ÿ'+Ë®¦WFäêÀC¯;ë‰§VxÅ?vú¤
Ø‹×±²&úÒâ;Oj·jÂ)˜‘—™¯~Õš1‹øÂyBd0úe<ã¶yR^iï–µÓ¢ˆnH‰4Õ\)F,D©rö Ï‰?§Ÿ;bš½>`‰üõ>-_&ÏC1][YĞ³Se8Áà”._bÌDpğ—Ö7Ô@ù›‘€¾ƒ”Pf8EºÛŞÇ(Ñ¦gKB4s¬.
]³0¥êZ"c¾÷^¦&B÷­¢Ğİ5ikÅÇ·7<ø’ ¡ ş7LúÁÓCG'r+fB1ÆûüÑóôÃÏàõaÊ)š¡ ãe3^P¹4[)ÄÀĞ-Ë¥a‚–Êb$ß¾¡;Eb»¢I#É· œ´m=veAâ&-çP1#­"Ä:¶÷İş»ÅêZ7Õ¸¹etD›TııiTô¶tçÖ.û„N¹a4Œ¡Ú…^¾sÄ»€ÏR7öb ú|¿XTFQ|[ãÚ¿Æ¼Kî¿NNô‚ÎKG…¼ÚºVZ,¡ƒ.;pœ0täÇ:È¥Ç4Ë¿"oğ6±û¿"|ÿ 0 ¼üŸ›«[QÈŒ.šeY€MßÏÚAI
^„8Ó‡8¡r\î$)Ck=ˆÒƒ­Š¡­ìF	§\¥ŞØO“qtºŒgZEÖ¶90®ü8>r‡4…ÙÑ­ï×~3PìL*¹ÚlÀÚLÓd­ÈÙ ŸÍf°ÖE~åñÊê¸õxOì>”ùn¥ßœÿ#×~')Wİ±†ÜnÊdqå±>ÕŸ#Ó|JÅ€ª9ùÃúDDx`¡R5¯Öú	˜ú¿— ‚:ùœ·kËê	—ƒ¯¯¨ïªœ ¤ÚA|AõÄ‚îKfşıeâÊo¬%úe²½Ø¸*É“ß.!§Tãvé5%5]ztö²Šáa‚õíƒ§0şµúÚ»y{ÏtıŸöšìÏbí.xª¡í–¹)¹.Oª;…éL+Ü¶#¡Yêîè]û‘¤=YI—ÿüòZÎähl­Ş ¬Y6ë¸†ÈÕn¸·´¶¦Éàƒ,ó…ÈåË¨jw1vWÆ†©bÔéM¼4û‰YpNvó›@Uš˜?¨€ïä]#Nı²g\82zŞh/tº‰ì˜Òšÿ­öûà¼vÁFwÇCÌğ’¬Î™š>²eƒ†,Aãb?†)KÛşy$SÓk)³ì"ÃóºKÄıô7äöâÈ¸Öó^8mÈV¬]„¢Bl	®ry•&nŠ9F²Şˆ#¢‘ÚåíÏ)15úw,ª½Áš„dD] §ÎbF.ØbÍ´
ğøWÍ·aøñğ½£h—şù{AÌ ^OŞë5”çvš¶5š·™1{ûË¸#=ùˆØÃ"ŞoO¶@ı± ¢ğchéd¦÷õ¥W9Š›5¥¨ÅÅ&ª<{–ïäBùï¬{ÚlÌb1kjÔæ C^–Û-w@TİB·@u*úJ’AŸc²P]îDğSB­xîĞg§D¬w<'FÄ[–`Ä!`c•,fk®6ş–z÷Ê›ÿv5í#)y+<®s›'gÎm\cáˆ©,Å=†À*p“x„#„>½kFıúÈdşo6[•]ñš³g©ıÅÒAW†ñ­v×6w:ÊâF‹ZÊÊŒzMe¼Ú&©æŞ2„$c×úE˜bê’i¼°î;nşZã{òÉ‘Îbëå#tËäDÑ´¶‡­?ß¯ëXBª#¾½ 	ç3çR°—]ƒìPJø¤1e< ÷’y6ÛãI—H¦]ÉÒf­
º÷_.şÓÆŠÏò²—‚nDò°  ğêXò7:×¯³IõX9Ê¿V,d;_ùÛqªlgª9øûŒ~!Î]ùlˆÁÜpªØò­@ÍŠõ{û•J9CÂu¦²¸ˆ–¨b„ÌÈ£êŒwüRç7Dò…q¼?T¥ÅÜÆ5):ÎØU°7ÊŞÿˆ& Î£3Vk.&£);á‘Ø”2	Ä7]6[¿U¤a*üÈ¥V•â1ÌéÍ_1 ¯xÀÿ#å?/À(:eMU!64m”<Ö}{Öµ@jCÔF|(Õ ¨¶È¸+.i4Â/`öTñ¡¨ü´$¾÷.ªAS 8¯IzÔu7i°«±l˜,WÅ=™Fˆ¿ÏğhÆ`‡8ìUœ¥ç…‘d‘¾.l„3em|Á¿ùs¦2e÷·˜l1¿KÆô‚môéx.®gEW7Ñ_îÛìØŒA‰ëÕ)€ƒvè…±‹è+®áğÙøHi	s;—¸J×ªğ,9RÅ¯”KœIãXá‰@4{†·#f"À©}«%‘ ×Q¢UöÌ?É5†ËâAê,v?w·2$™i=Öìhà˜µ›+¦²@®AøøË”"PÂa6—:—‰ Moñ.òêïfÅ6-î-$r¨
®sÔD#w³Ê¯Âv÷ú’m8Ks¾™Æ: œÌ¡¶ª5v‘Ï 4|”Ğå€ ‡Õr¿)".5¬ê¯!…ßH^2tÉïqFƒØâ'`Š,ëğkœşœnÇŠ±/6‡+>&LüòE—N»6Q`ÄäC M[¼²ƒ3sŸJÅ¬ËŸ#]èÌB§Ú·ùóÆ”Ã›‡œF´`$&dîwDø)ÍI®‘È‹N7ˆ;YÏ¿JŒ#L„^È´8puÔˆ(È?á/))ÚÏAÎ’í‹ÛèVt%µ¼ı¾—ÊR³áLÄe>ÛHìV©œ³ªA&¼2NfT šDñsaë$ã,ü¥7ÛÜ´O0§w³-Ş#`\Ãí„~ìBµ‹ùRÀwC]Œ˜Üw GsÙªƒf8z‹h>ÛÌ‡ŠRêf¢Œ´gò?ğ‚¦›úRÁú˜î*¸!q§:.U	ˆæBR$ìÕºÚÊÄÀª`>Pçì¬cõM÷ôtµ\:ú,s?±7<0©¿Œ
À€±CkÌèÊIZYQ°xBuç«q]º2Ğ0qªÈEŒbo^	hH%¿Šxñ–‚FâRâk\Z|¨mş³ç¥T.öâğí7ß˜E¡P²‡1µŠ¹¤EÑú|üÂ›:í¤ŸSµçæ¦%AfŸèfmpoÇİÉ÷öã›À†×Lk£|sŸ="vŞ„®wÀPİüİ6×Ñ[”vl‰ò¹¢øAú§>É$6!½ufBğš= dˆ»5n8õˆØÃ0œ'×¼ÁX°ZOç6jg­NÄ­R¥İõı[ñYœJnÑ¢ã‹:ÁŸ¨şÚ0Qu÷Å w}î[¹Š·ò	£j1T¼ÆÅI6”ódMˆ”YÒ£¨*çÎr¨ñ·GÍüÊ‚',Ïr…ÿaé@'ºeaÙÇ½ÌÔç!ˆÒgÍ{ªHí	™˜}bªİ ¨b8À”H(,R8¬•±Ìˆß¨²I×c
\²{Fat»ÏÈÀA¯ğ§7li0º©±2Ù‚ñ¹ú”[7lÍ»×kôó!T2ìÇ+…ÄCU÷ºıàátHEgæÂ¬;„=Ôd>"	Å¬bëØœá†è2m{€‰œœju3çÚ¾K½ñ”v¬¿Èçã¨ÄØŒ©%V½ÜG´SMÓ¬ÓØŠ1Ğä¯l+ÅÛ©hti93#ì C“ƒÒÜ™X)Ö³tKÃæ—}7Ÿ` Y€@ßeşÏ[>ŞV ö ohÁŠ•L_=3ØeF«ëğ²
¿Ö ú\¦a@ÜL‹£Ğò·¼Ü¬˜fíÅ?²XŠPô*°
ş½^âzm@éüí.¢»8s«î5Ä™S¤Z´V—ìæ¹^Qò.	¾wûÎ™4İl;s£„RYbW+ö¦jWü`Ji¼³T"Ùj ÏğĞj›»VqOU
O¨àßëëˆG“=â=.qc+Ä¸–•'/RA"äg7RîOz€ø·ší¬€sãúvM?æ3#½OÛª˜o³â˜¯Wm`£n÷¤ŸNË8ÛY(4Ì3gÆÊÏ¹@5Ø¯ÄğN(0ØİöÄ oĞ‘d_l$ĞÚäTl’P)N³Ù7ğª®UQ`ï	_÷)t«¬Çœ
 	şôG‰ÁûSt9ÂQö<Ç"Õ+ñîó¦®P©XÃ&qjÛ#€_óÙÏÚ•s’äÆœ• ‡™NÇôøÛ„GmåqQsÆMbÊ0'p¹µœš”ßPıF³x[$äÓY§\Ó˜½¯jÌ>¿]²àÄËDÆÄQ{]KäÙ Î·#™Ãn’Ldš™û|0ôÌí»|	Î-9U'ÁC$`ñwà<­$ÆvªçbÌÔNÇf6ë£ü7Æ{ÁFÔe=˜\4üÖÆ˜Éô)ÛöU4‚®ÔQ¾ï(ş3ÚçH–'ö_Øà‚™¾‘çL¶™wv¨GdëÑ¢.r+C‚ç~€ˆ'-*6ÑÈ’kœ’9(°1D¿.c,;`ã”gËÁmÿ
ø‚*öJ®…]“ugW»ªœ'ı¬šs“”Û’êQ_ïÚ™”Œ²Û©…hôRÑûq“ÿÔÈã7ásMĞ[b^ÅOï$ÓäñÉ?àçIœió¯,ñönåÔéP{˜G¨›1Åu¶“9Ëô|éûôVÒ…§3 àQÍÅä<’(fVF=ámy…ù½[nõYÇS·A‘æíÑcF÷-û§3o“… vºW’á„˜­[ìFE°‹õ)çï\ú¶ÂÃÂÂßĞ?ß¤uW•~Õı•~‹LÑ?ü{Ù”éYlê¤MÙaÏğÛ·H'Ã&¨W¤@´1EQ“£¾lrãOËy~äÒ_ ”;S¡?‘ĞA\n»7õº¾„,cI¿íòÇæÑï¥Ö>cùÆÀïíæ1G šı¢IóZÅ÷Ü¢?£N£µnV¬Ô`	`vÒØÀ]xìü¥V™Í­(Ïû¤gU&ÜttÜ4Ån2éØa––¹µéÎqÉÄBæ³¾sì¨²f]Îf\G6SIoÚf‡ÕÃFª\íº@ûŞËwŒÚ±ólY-­Åïp$Q:¢ÛV¹‰NÕÓ2#…¸Ÿ-K§7Ó;Qù+è¥#hWÅÃ-Ù©[¥§+µ€‚Ş'áN
áÎÿ<#,ö<qÑ^A)®ˆÕ'-9¨A¢zn§8ºò÷3Ø½ÿ©ãZKGÈM	V[?ù}ŒBêàÒ5µÂˆ/qgoì¬ã¬¬,Ê4Ìi»ë]Æ,ßf¹ßM—ÂÊˆEAÿøo^H½şĞ0ÌİÊ¼¨£û‘ôúá:¹,ñ~fÀÅysUáoCªWÉ(™ÍöYÓã¶Cã·¤AÍWZ{qÀÿ!’_€›,Å²~f|¡º"ÓrÑ¬U(Lİyíİ¦kB²ÍRKrÙ¢–ê¡ö#mÿ¨Ş­±Ö’™ÏâÁ¤çÿüÀ©n¥“lUK­âí	6 ˜p—)íïÖ«eE
qÉ=åå’h*¸:ğCÈ?Ã³B+¹=9} &Šxçe­qj7z1õUÜ|H‰Ï#Ğ	Í0èà™±cÄ>jmô\Õ>,•áÖÚP#¤>\¹G\ğĞŞÄ…€E÷}¿ãÌ«Ìµ¦§)ïCW^É1œ~-Nª2…ÔE&Àd3; £ĞĞíÌøXÛc#«9Ş«rÙDq$L
ı%®{d\Ëˆš1|c÷†	
DKƒª/ù–]™srÌØ8—^‘¨{(ÔwÍ—²šƒN(x8ò~,kzH¥§.°Ö g!¢‰EcîS„ˆõƒ5¿yïû59ß‹7'†ğZ¦üıÄŠŸÌH,ß¡ßªX'7Ó¼ØõùÓaQì`ŞÛFGŞ£¹YDî^'¼Ç®VVÆ)e VÄC+û†5ø÷¾I‹r‹{ÔãNÙø¥!Waö“?¢ˆàûv§èÚJû~Æcñt¬|Â3¦×hA&ÌkvcƒŒŞÈŞ+§ƒ3Ê-•ïôÍk7İªéş:X`xéXÎËÒOÇ$à5Î<‚õÏº!Wîkô¾ï5ÔÛ¡óLeŸÔ#{ÚÑáe³W‘ÍZ¾Ï»°wmM®kÄKæûŒ•yË»'=ª7zøÍfdîóè[´¿hmÉìGâßÖ÷İ”:5ñ0¨zÈ(†Ù/d¶hT!ÏªË Ô…Úx6Æ(wB¡xr•{€¨ÁÉĞû(áP¢¤#±Ìâ‚”¦½sI{ğÖoS‡ÖÅãÒÈnÎ–,&*ƒWP£|êE¢Yè÷À6XúÉRèUC©…¶ÄÏÂbpOnİeBÿÂ6ÌÂ^Î{L¢xIH9·AĞ„ğÆÄ«gÁ%SYÈ2/–%jjPé¦’®ßz!€q’ƒòş«FX¿)ÕüÜs,,üúc6[1'=0¤¢¾tigN3bÒÚGôlş¼D4™Cé8wp%µaH7	U­QÆÿzL$r·¥ÑVG`¾äI]dßHØÄæÛP¬UĞXr%RÍÔ ±¬We,PxSXı?¬'Ô÷~ğ°¬ãyûu½d¢Ù6çŸ9ËYhú¦Ù¶&î®xQ²0ŞHPYÕ¥MûîÏÏQ€áĞuÀô€œ¬+q†úL/^d
fO¿1š•'4dé5ÂÅ–Şl´Íö÷Æbë+t9JÃo„kVI/ê‘ÿø²¥ÚHL.©ø¬˜?(0$tqA¥÷èI#¢öøLFÆ5}'ŒkÌ~u·KÏ/9ûe‘LU?GöÍskìiÄj_] ¦°x’AW³O¡³H¶<{üĞD>¤nşJçş`2|63î¢€2ÖäÇê¦•\$T³ ö7ÃšôW£êt«åŸ²˜NwôŞĞsÎo²uj;%@.R‰Ñ¸Çëúß/;4­µy¤Ï¯Î€'Åx9æŠÕşÓ!ü®s*<¶|ĞíÍBBÚ[Úç¦³h*ğÌ@/°´¦ÈÙ¯ßCî3Ã'÷îb¼˜İ0„8ú5ØĞ²)İ“ÕQ	M¦ªĞKl±Bj¿ã”èe¨Âl7'¡»Á³Ya%S¯b¤SEĞh=¬Gÿ&[mÿ~æ1‡¶Ó‚wLjW#ö±ç>¡Ò¾HbÎcQµ©ß³8±Á˜sù<ØLŠ.¡Åho`JòäÍŞ—I´­§ëé(ïïÈ¿	/æ¨İÔ¼­çL*.•Õ©*95³	çÁ×ï©HëHH8Ël¦aªÃ¢<ÔõÀ> mN°ò0
º‘Ù3Ó*NŒíoŒ†^ñ½ÓaçàSŒ‘ŠãOËb¾øâ:R`
_À3ƒt‰… ±° î!Jı¤&6h¬Ûn…5'Ûcş#EãÜVd|tKşu•†…¼ÁØ-¤ïZçÉÇ•â#k™C_;EV?Ê/®5>$Ñ|+îåc¾êMLQVÚYxÇÎ‘"õò-? ÜÚ9^ÊPËƒ8 …_-{|+h+ĞfÏY’¸Òpjw©sñAnò+îGônabhÄˆXè¬×EÑÌP_Ööóäãéè z»$»de„N)#¸­Õ)n‰lœº—8å¯ ì–Û¿Á•€Š=}Ì3fòÉ¿¿Z*ãùnw÷æŸhñßë€„¢ñ³ÄY»;ô_rLÇ,»eà˜¤çø?+‰Ñ`Rò¿hü–ê4^äwÆœâÎ4ôqn
éásŸ9õ06"›®~÷P©~}‹™$óß·ßı	y1Ç+^»Uë´m^·è“‚nï†,ÜqBnÙÌÆ˜¸÷„ÒÄ*NŞZ+Òæl½şE¦·2vT^ú”Ó„†á÷–¶2¦a=1 s£Fû‘Æ¨Bv8FphÔ°œC¯ßşzëàÿ\ş‚·³„`G´nŒjp 1ìÕh™jÆĞ¬Ø5,'´‚>y’ˆ}ækÛ~½´ÉàÓaŠO›~ûT-ÀY;Ì£‚ñ¹ÖÈ*X{2Ødëi~¹ÖÀCq\•óMÊƒQìBË]ë¸ÆV;áBısær˜T‰]xj ŠÎtø(#Ê”YFéCÔ\t*Ç·*q^R\ÒÉ0ãaTÅ(ATµ?zÃûúé»/EÜ¼`Ğ	—§ÅÇMˆ#ıIÉRÀiŞb&^C¼FÖvµ¶çk .$rI¤;ÈÚÄüÀW'§É\§ÒÃÿG¼ØU}¯8JÌKN—6•¢]d»À¦“£02Xì‡¾ª¸Je?€Á…*oâƒß;Öª)C9 ÍÓ4”7\"
k/J&?ub¶ñi†ú—Öõõ‡eMV›w9UCLmL#¸SFŠ±*Sš¶éÎxñ€Ï¬”U@ğ¡—áJgÉ¹$Wy»±‚¯cO‡‡İİ»MÇßuŞÜ6t®$—{Åí1í‡çZâkRÕ6727¶¶ãeåÒGV¨B¥Àæ0·N¼†©)ªò}î —Z“ÅhŠPK,!Q2§œÊpÏÉ ÖÎ£ì@ìS)-àeŒR|[º¤OùO3ê¶t|´µAœ%Ï”[ ÓiøxôÑs¯î¤ÀüNohŠ[Y·Ì¶¯³0tU¼–®™\b÷%_Æ„¹({¥Y/‚ä‚€®uæœšĞ}eàƒZÕ#g$|>L‚Î+ÏUR®P‘Ã Ï±ÌœC€õ™‹³ÊäwÖåç2±×ÏÃè¿†%ıœÀbù¿ßĞE¦×w‹“À
øQE±\`®
[A.iŠŸÌs‡~D"³¬=äÂø]5#¥*©­IßbäÒo7ä+Ïã „¤¬å\Urc"g¥^ü}ÖÊol* fP’â1›«[ªğ?Ÿş¤BJÄ |¾ZğÜ¿J¨hŒbÑ‹¼ÿuìmGäÂñäúØ¡Â«sØ?ÄŞŒ°ÎŸß/mõ†2d«IˆO%-L%IËo‡’‚j“­Q‚?\Œ;Vßëî›l¥–œ N£u¯nÚé³ó#hÕ¶%†ó%âk;òo¼PÓ€q)ô?[>i7ŞÊ$Aãù~EU5t²ÍgƒúşrBËY(ùex½é¾á°‡Ş{¸z.kü¯Ÿ‡…Xå‹gT6¶^„Û¦ßU0_GÅç"z•ï‰CX³~©õv((Ô_FQå¯3eëTÅÄ_ØœÊ§’ŒºÖb¡ ~v~[SpI2øBàOnñĞS®q^E3»aiÿ
Ú’ìê€zÙ•={³ˆHCï@x„‡›¦à£OŞGùı)XØ­Œ|÷«Õ):±AF1Øú¿;áXœsìj¡:7¸¤¯wõÁ¶»B#Bb`ŸÛ~5Í˜M$½ê`yü_÷úİ˜÷Ğ§Õ-$H½d­78å³ƒ»]=)‡{öIw»*ÔCêaµNùÛÏï£`åÙúíAB”
›”ïŠº«Rt†³[1/°D·X›t¶Êiğâá¡`íˆ>Û[†a‰Ä	V€éÔ›0—©w’„Wš¤M¥y£´q>–5@WñÃ`ËBÊÛW‚â¯IØLÜdåõàøÁê1¬q>Y|Ú^vKİ‰µéÅÒàaølÉ
mMô³Ø¶RkÆük¨AÒ#ÙÈó™
ŒqÖ0Á4ß‘gÒdäüía½ç o“œÒJşós¸ùoêîâG¹çvR6|}^éiäØ<BS®Q>™ªTácÁzü8§÷0c‚.¡İ€œ¤uÁÈIHŠ[øV@Çuì½q£“2›Ïú‡Ìy<´¬5î,…#µ"{(×V—¡DoŒ˜Âõıâôhgq™6Ğ¨Ë„LÏù°äªy&II.íYc.!`¬šsRğÖD N>¼µ›.0×–7ˆöó9] M™¯µlÔ2½"ƒŠqêÈ™Û°ò±ÿØ½cõ?[×H»˜_áÁã"‡Ê7kg]; y@ÖÀÍÅd
ã}{M°?şG´©÷=v×t Û*_“mµ¼5¾°ø‹cöƒŒz£åÒ#îÏl#ÁÎm"²×İRu1Õ•®Ø#/ÙÔŒ÷\†„:[”#şÕÿq¤nèQìºüÿ¡TïlÎ´šÄÂ½Ì°FEŞ#gŸïRãı/ˆÑeÌÛßE©£ns$©ŒH‚.Ûš†&CG\)ûÂ•³Áà[‚MÔÌØw–Cª;tà{€Zø4Ç¾qWmF„M¿R}¦³j¨8^{QÜÂ:±°¨›(8`>áâîF±zSnù²‡şB °¤'ËıvNk"^iñ	Ä>«¯ljc¤>]õ«3£­\3¿ŠûÌ?ë>!–öPHyüûÎyfåÓ\ŞşÌq˜´3KåB­OÎv8ª“BÔ¦`‘üÑ³ä¤O;™¢ğa¤°Ìr¶È9(»xPğÌşº.L®µĞÏøÍ	8±6¶Qã|ˆ½{(jGûwN´à²7È‡pq/a¸ı´W|ãŞñf;–ÀÜì}bÄ+•)ŞÔ
¥·XåÖ¤#„%“İØ´Ï¶¹xúıdKĞ@ÁæÍ¤¡(k6˜F½³ÚƒFøGÍÖ‡
†ìş£w¥GĞ5uùsŸhßÏW	oœ½]œ d‘çH¡‘{¨jpVl5ŒXx—,¼yiøŞaØtßëßYŸßà.®7„å£;í‰,!‹ş¾n¦™xA.ª"hqc6ìûXw_a¥
»~ö×šåGPŞ]4û4Î?¯=xõßF¾¼İ}HKífA¥ ¨au.‚ºAm]öˆ³ZC­±E‚ÆVYİ6ÿ‰WUrh4=çùFÛwJH:€j‹+·M'ÊBÃºrCù¤Øuå=“”û(Ü*%ä/·åf÷Êgÿô‚ù‘Âµ†Ì¤4x°ıÊĞdôõ¬k$6cYˆÊ7f~§´ª…çšT@~İ¦Û<€|%ßëv­q’`´ä´¶³¡	<®dŸçè¨ïZ”Vç~ê êF÷]‡•µMí}Õ"•õ!T‹Ghë£Oæ=Üğ7É§ªü„™Nı{4aM)õ´dëvÄÅxá˜Rê°næºQêÔWSócÚ…oòpüşï £¤Š,¬Œ¥ómQ¤Pİ3gu‰QO›İµZ†©~ ºƒ	ó"DR*‚°tP¤Î> ×±ˆ;G'ÿ\M7twºJuĞÙö
¢ÈwÙGÑ" ©E1&Ş	²õC¡ÓWºKêé=Qb¹ã!!´jî•æ$Ì‚l4h§m;MË6Ùr4×³…wiÆ„	À^Ô®wã<C‡¼’¼§Ó#\A‚Gk“¥/üŞ¾ºH —aO†‹ç&Iîf„å³”O¦(Ì2pJ¾rYnëvÒùÑ¯ô¯˜s!®à€Š¹ÜS#Ê_{ŠGp²7¨Ã”bÍ±ª· (¸rùİ%}ˆ—ÎK-ì„QŸß“ªrˆ7aÀ»„°ìXL§œç2¯¾DV±µ^Š‹[8û.¢ÖÈäR94¦~¬”Üˆ@ß6ê;vïImì3Ï³½ÈnI›õ!®Ò5½ûˆ†a~VAàğ,sc ûıØ´p7Ñâ²®LSØ$‘õO¨P*zgÍS ª*XQñ3‘l…¹6ò·5İ©ò5*—i*“éy¿›³YúŒ“ğ˜ÊŒâ¬E‚1ñi*j’†;#Mîİ¾iğ”ó•:\šå­0šQE):†ÃÏ÷‹éÎ$Æùúog'ÄÖôáÍ<oÇWó:H€¯Á]X$t¶A·|ó !w¬}Q!Âueë|íbMŸ6ş—œÉªf÷!,ò:Lš£‡§•Ày( 'Ì_Qeb¯÷:c³ñ>M«ø|%ğïŒöÙT½š¸K{gaw]Ó!;Rjqzş£dm"
 >ØNaüÈE¹#ŠZ½w .0î¯„‘›0ºÅ70¾*‚¿‘±ÌØï¤2RòRÆîDs\ò¥&İÄnÇÕ\¨Ã9k¤JY€ È7p?C´ñÎiäöi¯†¾Í^r$Ğú¤ş=­ô ªÕNWúöá×q§Ü›l¦ÕÖµ3xï|¤Ø±‰yˆ2müY¤•rh İ&c“#¦3Nd=»ø­4zÅ:)0ÀìT«ë¶§¼KĞ›iõJ|b„™ajğá¸,»˜3toĞ˜]qk`…pYÆßß‚˜eóõË¦À„ÚouóIpâ"®=lf`1ºPX³p2Ÿc;ña|<25Û#såŒGÆïU‘Öë.$·bœÏª:%Ì¹”g÷yìl¦‹}°tmÀ•ê«Dê½ºRí¶n?ÛD©Ÿş“/iè·4‹³|ndê§øzíUB5tI¿
Ç«Rv>áx®Iøâ„¡>|6÷æ-ÒtkJd¹¡Jq_SD“´±Ïp>Û”ÒÆXk¯ğîjàd2—_c}½¼¼Ë^$Œ-Î=2sZìKáUFëRÈ:ü.c6´÷Ù®zZÄï¨0ºs¤Kmäãù)èT‚ U:ş=ÏıˆX>75óõ}ÉÁÅ
	ó­¬¶!NjÒ¤DâÏèpblÊ/‚÷s‹„RÍ!ï¨,Mÿê*jÛKuª}:#È¥y¡ıpXÈd¹a±n@în¶³$b,¹Bnï£‰.qz˜Å­‡I·qÜMwE2XÛ11TÀH~şŞ¸¾ÿüó€9Xp‚¬’Ê7XSöÖ¦¶PdN÷ÆK:Ÿ¬iÁ	AhãM¥76{1|ı^´bÊÂ9*ç²ãº;jˆ®üÛèfj£“TM|ıuÁïŞ¿I nü©Q¦JƒˆÈS~H¥^˜Ñ£VÖv‰“†R;]É'ÿÎkS1ëˆ_‰ù½1ï[’ã~ëÌ‹ÒĞÖX7.ÍbÕ	âÇ~e!áï–iŸ NO®O7B¾©V~Áå{RÛ{­¾/’á]´nTÇîcAêKïŠúÇ+ÓÍıÛ(0æBÁ>^w¥é8.¼]nÁü˜Ÿl¾ú/árK5µ8‹aRª’¦È–í©quû5Ø;6\°\Ö¸j6›ôîÌÊËîé‡‘¨ñ.8Ÿœ`kâ«Ö‡ ïd>¿-ÈëºŒe•G•j|óo
íS˜4‹B7ŠØúLìka}D„ÏÜôÃr4òUgûF¼)HRŸ©†Oõ(ãt‹ŠÂgY–!U RÕˆMí¥añ‚á½`µÇñÒs[&=¹…k Sx†¶Ñµ‡åµÁ¡òzÆ×ù1ó€‘KüïT¼ŸÖætsfˆö
¡š:\¼Ÿ”pH;Š¯9õş§ V¹îƒ‘†ˆ¡óyMÅ_‘Oñƒâs ÊÓõ}òãºĞSç¤½s;iJwÚƒô¥]ğñ%TÏôî¢4[Xêw×):³ğÄYú|f‰/`ç@~<fÜ6ë•¾DRfÁåçñÅ~D³Fvóş#e^DÖ¥éO/³¼Ù@/ü>WÉû@‚Ap2ßš8¤M%QFa9©eğ	y.Ìà­§é'ì)+w<aØ•a#ğa·oŞ¯İíû«™â-†íÉéˆˆJJb(>Guõ*¥@' @ıÒ^R–îò‡âÓ
BØŒªaCìVşÈÚğÌ¥^ŒQ	Ä]º È1ÚW¿ÄW-bÖöÙc0]±é%üŒ2È­ÇñSÌÙÃ‹©#ûŸ8ù=ûrÚa¦'UeJòÌ¹æj/„el©…ı#9W7A
ÉÄ?ã£°ğÇv°cÁ$×H´EÏXeËèvÍ,³ösÇbx/&/lJƒÃ+Cn¤	BÙ³İÅ@ }í¤ïv¯&½Ê…ìBQåüŞ9I¢í÷©Çñ@)4t7Ø&U’ê§ÉŒ~p;§9V$i	û|ù­‰ÆS1âÜï?o”gè)åwz@¦„ÖÜ½nBÚ@‹¢<j¥^²X¸?¯¢B­SÀÜ¬R OmX{yã…hÚ	­zX¸·Æğ,$1vËCô2”ÅuJCÔĞƒ!gï	Jöß¾Ï]©$xÕ!}èÜW‡ÈÑ;¦”@ÓV@²—‘NÅØûã+ÙbÌÂ”Âé 0ôİj«È–¬Š	œj¹¿R)çöù#cíÁv`ŸuÙÅKdI¤$tZñ‡+š¼ÛÄL?@P½¾CìT5…Xù'«n«^:ZU<XnŸ¥.’à¡ĞwÍV½,e¶«³Xş³˜Rß-YïøG	a§-#ŸŞá9³µ ?IëêÑCÍ
¨Q¢¯³FŸ0~Uíƒ%3—g_„·(»¼ÄÊP;§ìt];{nœ‰¹¸…ÆWç¢se²]ô‹ç"¸`» çXEËÔÂ_*Ì»ao é¯Ãm¬.íg;ÀŠ0ü:¯$Ğ@t_¨F.É.«W…Ç±IÕGP2Ñ(`mUÚH‡W#İİtúª`&eÌÖuggÿå°Ÿ9¤Y ú·c ¡ î´:Ô®cÕİÕ*åé¤ªfÖ×u‡¿Áë§»Œäû]i&x3Â¹§ê!Q¸Ğj5]	ÆÄ
„»Vôşœ²9ÕåÜADÂœ4Há£Ò ëeğ9´áaçäRI°UX¼M:‰Ç‰0¢<Íp÷íÔ„ÔCÎ³vÙZ§íàeÿñÇcbåRË7Ÿæ.l^	YøÅí%£5«LKô:	Iù‚…“ãÆÏ\Xnn±•v¢Ò?Íá	_pIú¢p¾]8'A)UÓÛ™•m²˜beı~1yebk3F@tñëcV:¬Ä—–¿]¶_æ¸|çp­ı†Ô4 ¸ú7¯Ñ'Zòæ úUÉø†´˜R–¥:%>¥¿ÂÉf­óm‡ÃÊk8…¾:Vşí·!0Îë™ßÖ|·k9í|x€>Œ „®m‚Â–Rå&J)¤£¾xO‘0)ƒfx0:UÒ g!,ß™¢ô™,õ70(ÿFÙx·/5+,!€ÚÛv’A?øPfó òò3»K‡¹µ#y¯H#Ñ?Ö ‹ù8UPX`@â“ É^ıË+¼‰šºËÃ_59iAgYXNzZXJ0Lm9rID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykuaXMub2s7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAubm90T2sob2JqZWN0LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgb2JqZWN0YCBpcyBmYWxzeS5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RPaygnZXZlcnl0aGluZycsICd0aGlzIHdpbGwgZmFpbCcpO1xuICAgKiAgICAgYXNzZXJ0Lm5vdE9rKGZhbHNlLCAndGhpcyB3aWxsIHBhc3MnKTtcbiAgICpcbiAgICogQG5hbWUgbm90T2tcbiAgICogQHBhcmFtIHtNaXhlZH0gb2JqZWN0IHRvIHRlc3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdE9rID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykuaXMubm90Lm9rO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyBub24tc3RyaWN0IGVxdWFsaXR5IChgPT1gKSBvZiBgYWN0dWFsYCBhbmQgYGV4cGVjdGVkYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5lcXVhbCgzLCAnMycsICc9PSBjb2VyY2VzIHZhbHVlcyB0byBzdHJpbmdzJyk7XG4gICAqXG4gICAqIEBuYW1lIGVxdWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZXF1YWwgPSBmdW5jdGlvbiAoYWN0LCBleHAsIG1zZykge1xuICAgIHZhciB0ZXN0ID0gbmV3IEFzc2VydGlvbihhY3QsIG1zZywgYXNzZXJ0LmVxdWFsKTtcblxuICAgIHRlc3QuYXNzZXJ0KFxuICAgICAgICBleHAgPT0gZmxhZyh0ZXN0LCAnb2JqZWN0JylcbiAgICAgICwgJ2V4cGVjdGVkICN7dGhpc30gdG8gZXF1YWwgI3tleHB9J1xuICAgICAgLCAnZXhwZWN0ZWQgI3t0aGlzfSB0byBub3QgZXF1YWwgI3thY3R9J1xuICAgICAgLCBleHBcbiAgICAgICwgYWN0XG4gICAgKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgbm9uLXN0cmljdCBpbmVxdWFsaXR5IChgIT1gKSBvZiBgYWN0dWFsYCBhbmQgYGV4cGVjdGVkYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RFcXVhbCgzLCA0LCAndGhlc2UgbnVtYmVycyBhcmUgbm90IGVxdWFsJyk7XG4gICAqXG4gICAqIEBuYW1lIG5vdEVxdWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubm90RXF1YWwgPSBmdW5jdGlvbiAoYWN0LCBleHAsIG1zZykge1xuICAgIHZhciB0ZXN0ID0gbmV3IEFzc2VydGlvbihhY3QsIG1zZywgYXNzZXJ0Lm5vdEVxdWFsKTtcblxuICAgIHRlc3QuYXNzZXJ0KFxuICAgICAgICBleHAgIT0gZmxhZyh0ZXN0LCAnb2JqZWN0JylcbiAgICAgICwgJ2V4cGVjdGVkICN7dGhpc30gdG8gbm90IGVxdWFsICN7ZXhwfSdcbiAgICAgICwgJ2V4cGVjdGVkICN7dGhpc30gdG8gZXF1YWwgI3thY3R9J1xuICAgICAgLCBleHBcbiAgICAgICwgYWN0XG4gICAgKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5zdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgc3RyaWN0IGVxdWFsaXR5IChgPT09YCkgb2YgYGFjdHVhbGAgYW5kIGBleHBlY3RlZGAuXG4gICAqXG4gICAqICAgICBhc3NlcnQuc3RyaWN0RXF1YWwodHJ1ZSwgdHJ1ZSwgJ3RoZXNlIGJvb2xlYW5zIGFyZSBzdHJpY3RseSBlcXVhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBzdHJpY3RFcXVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBhY3R1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gZXhwZWN0ZWRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LnN0cmljdEVxdWFsID0gZnVuY3Rpb24gKGFjdCwgZXhwLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGFjdCwgbXNnKS50by5lcXVhbChleHApO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdFN0cmljdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyBzdHJpY3QgaW5lcXVhbGl0eSAoYCE9PWApIG9mIGBhY3R1YWxgIGFuZCBgZXhwZWN0ZWRgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0Lm5vdFN0cmljdEVxdWFsKDMsICczJywgJ25vIGNvZXJjaW9uIGZvciBzdHJpY3QgZXF1YWxpdHknKTtcbiAgICpcbiAgICogQG5hbWUgbm90U3RyaWN0RXF1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gYWN0dWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGV4cGVjdGVkXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5ub3RTdHJpY3RFcXVhbCA9IGZ1bmN0aW9uIChhY3QsIGV4cCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihhY3QsIG1zZykudG8ubm90LmVxdWFsKGV4cCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBhY3R1YWxgIGlzIGRlZXBseSBlcXVhbCB0byBgZXhwZWN0ZWRgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmRlZXBFcXVhbCh7IHRlYTogJ2dyZWVuJyB9LCB7IHRlYTogJ2dyZWVuJyB9KTtcbiAgICpcbiAgICogQG5hbWUgZGVlcEVxdWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZGVlcEVxdWFsID0gZnVuY3Rpb24gKGFjdCwgZXhwLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGFjdCwgbXNnKS50by5lcWwoZXhwKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3REZWVwRXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnQgdGhhdCBgYWN0dWFsYCBpcyBub3QgZGVlcGx5IGVxdWFsIHRvIGBleHBlY3RlZGAuXG4gICAqXG4gICAqICAgICBhc3NlcnQubm90RGVlcEVxdWFsKHsgdGVhOiAnZ3JlZW4nIH0sIHsgdGVhOiAnamFzbWluZScgfSk7XG4gICAqXG4gICAqIEBuYW1lIG5vdERlZXBFcXVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBhY3R1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gZXhwZWN0ZWRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdERlZXBFcXVhbCA9IGZ1bmN0aW9uIChhY3QsIGV4cCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihhY3QsIG1zZykudG8ubm90LmVxbChleHApO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzVHJ1ZSh2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyB0cnVlLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYVNlcnZlZCA9IHRydWU7XG4gICAqICAgICBhc3NlcnQuaXNUcnVlKHRlYVNlcnZlZCwgJ3RoZSB0ZWEgaGFzIGJlZW4gc2VydmVkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzVHJ1ZVxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNBYm92ZSA9IGZ1bmN0aW9uICh2YWwsIGFidiwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYWJvdmUoYWJ2KTtcbiAgfTtcblxuICAgLyoqXG4gICAqICMjIyAuaXNBYm92ZSh2YWx1ZVRvQ2hlY2ssIHZhbHVlVG9CZUFib3ZlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgYHZhbHVlVG9DaGVja2AgaXMgc3RyaWN0bHkgZ3JlYXRlciB0aGFuICg+KSBgdmFsdWVUb0JlQWJvdmVgXG4gICAqXG4gICAqICAgICBhc3NlcnQuaXNBYm92ZSg1LCAyLCAnNSBpcyBzdHJpY3RseSBncmVhdGVyIHRoYW4gMicpO1xuICAgKlxuICAgKiBAbmFtZSBpc0Fib3ZlXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlVG9DaGVja1xuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVRvQmVBYm92ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNCZWxvdyA9IGZ1bmN0aW9uICh2YWwsIGJsdywgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYmVsb3coYmx3KTtcbiAgfTtcblxuICAgLyoqXG4gICAqICMjIyAuaXNCZWxvdyh2YWx1ZVRvQ2hlY2ssIHZhbHVlVG9CZUJlbG93LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgYHZhbHVlVG9DaGVja2AgaXMgc3RyaWN0bHkgbGVzcyB0aGFuICg8KSBgdmFsdWVUb0JlQmVsb3dgXG4gICAqXG4gICAqICAgICBhc3NlcnQuaXNCZWxvdygzLCA2LCAnMyBpcyBzdHJpY3RseSBsZXNzIHRoYW4gNicpO1xuICAgKlxuICAgKiBAbmFtZSBpc0JlbG93XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlVG9DaGVja1xuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVRvQmVCZWxvd1xuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNUcnVlID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykuaXNbJ3RydWUnXTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc0ZhbHNlKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIGZhbHNlLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYVNlcnZlZCA9IGZhbHNlO1xuICAgKiAgICAgYXNzZXJ0LmlzRmFsc2UodGVhU2VydmVkLCAnbm8gdGVhIHlldD8gaG1tLi4uJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzRmFsc2VcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzRmFsc2UgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS5pc1snZmFsc2UnXTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc051bGwodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgbnVsbC5cbiAgICpcbiAgICogICAgIGFzc2VydC5pc051bGwoZXJyLCAndGhlcmUgd2FzIG5vIGVycm9yJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzTnVsbFxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNOdWxsID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uZXF1YWwobnVsbCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNOb3ROdWxsKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIG5vdCBudWxsLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYSA9ICd0YXN0eSBjaGFpJztcbiAgICogICAgIGFzc2VydC5pc05vdE51bGwodGVhLCAnZ3JlYXQsIHRpbWUgZm9yIHRlYSEnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3ROdWxsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc05vdE51bGwgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuZXF1YWwobnVsbCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNVbmRlZmluZWQodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYHVuZGVmaW5lZGAuXG4gICAqXG4gICAqICAgICB2YXIgdGVhO1xuICAgKiAgICAgYXNzZXJ0LmlzVW5kZWZpbmVkKHRlYSwgJ25vIHRlYSBkZWZpbmVkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzVW5kZWZpbmVkXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc1VuZGVmaW5lZCA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmVxdWFsKHVuZGVmaW5lZCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNEZWZpbmVkKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIG5vdCBgdW5kZWZpbmVkYC5cbiAgICpcbiAgICogICAgIHZhciB0ZWEgPSAnY3VwIG9mIGNoYWknO1xuICAgKiAgICAgYXNzZXJ0LmlzRGVmaW5lZCh0ZWEsICd0ZWEgaGFzIGJlZW4gZGVmaW5lZCcpO1xuICAgKlxuICAgKiBAbmFtZSBpc0RlZmluZWRcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzRGVmaW5lZCA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLm5vdC5lcXVhbCh1bmRlZmluZWQpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzRnVuY3Rpb24odmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYSBmdW5jdGlvbi5cbiAgICpcbiAgICogICAgIGZ1bmN0aW9uIHNlcnZlVGVhKCkgeyByZXR1cm4gJ2N1cCBvZiB0ZWEnOyB9O1xuICAgKiAgICAgYXNzZXJ0LmlzRnVuY3Rpb24oc2VydmVUZWEsICdncmVhdCwgd2UgY2FuIGhhdmUgdGVhIG5vdycpO1xuICAgKlxuICAgKiBAbmFtZSBpc0Z1bmN0aW9uXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc0Z1bmN0aW9uID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYSgnZnVuY3Rpb24nKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc05vdEZ1bmN0aW9uKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIF9ub3RfIGEgZnVuY3Rpb24uXG4gICAqXG4gICAqICAgICB2YXIgc2VydmVUZWEgPSBbICdoZWF0JywgJ3BvdXInLCAnc2lwJyBdO1xuICAgKiAgICAgYXNzZXJ0LmlzTm90RnVuY3Rpb24oc2VydmVUZWEsICdncmVhdCwgd2UgaGF2ZSBsaXN0ZWQgdGhlIHN0ZXBzJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzTm90RnVuY3Rpb25cbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzTm90RnVuY3Rpb24gPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuYmUuYSgnZnVuY3Rpb24nKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc09iamVjdCh2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyBhbiBvYmplY3QgKGFzIHJldmVhbGVkIGJ5XG4gICAqIGBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nYCkuXG4gICAqXG4gICAqICAgICB2YXIgc2VsZWN0aW9uID0geyBuYW1lOiAnQ2hhaScsIHNlcnZlOiAnd2l0aCBzcGljZXMnIH07XG4gICAqICAgICBhc3NlcnQuaXNPYmplY3Qoc2VsZWN0aW9uLCAndGVhIHNlbGVjdGlvbiBpcyBhbiBvYmplY3QnKTtcbiAgICpcbiAgICogQG5hbWUgaXNPYmplY3RcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzT2JqZWN0ID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYSgnb2JqZWN0Jyk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNOb3RPYmplY3QodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgX25vdF8gYW4gb2JqZWN0LlxuICAgKlxuICAgKiAgICAgdmFyIHNlbGVjdGlvbiA9ICdjaGFpJ1xuICAgKiAgICAgYXNzZXJ0LmlzTm90T2JqZWN0KHNlbGVjdGlvbiwgJ3RlYSBzZWxlY3Rpb24gaXMgbm90IGFuIG9iamVjdCcpO1xuICAgKiAgICAgYXNzZXJ0LmlzTm90T2JqZWN0KG51bGwsICdudWxsIGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3RPYmplY3RcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzTm90T2JqZWN0ID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmEoJ29iamVjdCcpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzQXJyYXkodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYW4gYXJyYXkuXG4gICAqXG4gICAqICAgICB2YXIgbWVudSA9IFsgJ2dyZWVuJywgJ2NoYWknLCAnb29sb25nJyBdO1xuICAgKiAgICAgYXNzZXJ0LmlzQXJyYXkobWVudSwgJ3doYXQga2luZCBvZiB0ZWEgZG8gd2Ugd2FudD8nKTtcbiAgICpcbiAgICogQG5hbWUgaXNBcnJheVxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNBcnJheSA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmJlLmFuKCdhcnJheScpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90QXJyYXkodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgX25vdF8gYW4gYXJyYXkuXG4gICAqXG4gICAqICAgICB2YXIgbWVudSA9ICdncmVlbnxjaGFpfG9vbG9uZyc7XG4gICAqICAgICBhc3NlcnQuaXNOb3RBcnJheShtZW51LCAnd2hhdCBraW5kIG9mIHRlYSBkbyB3ZSB3YW50PycpO1xuICAgKlxuICAgKiBAbmFtZSBpc05vdEFycmF5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc05vdEFycmF5ID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmFuKCdhcnJheScpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzU3RyaW5nKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIGEgc3RyaW5nLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYU9yZGVyID0gJ2NoYWknO1xuICAgKiAgICAgYXNzZXJ0LmlzU3RyaW5nKHRlYU9yZGVyLCAnb3JkZXIgcGxhY2VkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzU3RyaW5nXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc1N0cmluZyA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmJlLmEoJ3N0cmluZycpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90U3RyaW5nKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIF9ub3RfIGEgc3RyaW5nLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYU9yZGVyID0gNDtcbiAgICogICAgIGFzc2VydC5pc05vdFN0cmluZyh0ZWFPcmRlciwgJ29yZGVyIHBsYWNlZCcpO1xuICAgKlxuICAgKiBAbmFtZSBpc05vdFN0cmluZ1xuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNOb3RTdHJpbmcgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuYmUuYSgnc3RyaW5nJyk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNOdW1iZXIodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYSBudW1iZXIuXG4gICAqXG4gICAqICAgICB2YXIgY3VwcyA9IDI7XG4gICAqICAgICBhc3NlcnQuaXNOdW1iZXIoY3VwcywgJ2hvdyBtYW55IGN1cHMnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOdW1iZXJcbiAgICogQHBhcmFtIHtOdW1iZXJ9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc051bWJlciA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmJlLmEoJ251bWJlcicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90TnVtYmVyKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIF9ub3RfIGEgbnVtYmVyLlxuICAgKlxuICAgKiAgICAgdmFyIGN1cHMgPSAnMiBjdXBzIHBsZWFzZSc7XG4gICAqICAgICBhc3NlcnQuaXNOb3ROdW1iZXIoY3VwcywgJ2hvdyBtYW55IGN1cHMnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3ROdW1iZXJcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzTm90TnVtYmVyID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmEoJ251bWJlcicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzQm9vbGVhbih2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyBhIGJvb2xlYW4uXG4gICAqXG4gICAqICAgICB2YXIgdGVhUmVhZHkgPSB0cnVlXG4gICAqICAgICAgICwgdGVhU2VydmVkID0gZmFsc2U7XG4gICAqXG4gICAqICAgICBhc3NlcnQuaXNCb29sZWFuKHRlYVJlYWR5LCAnaXMgdGhlIHRlYSByZWFkeScpO1xuICAgKiAgICAgYXNzZXJ0LmlzQm9vbGVhbih0ZWFTZXJ2ZWQsICdoYXMgdGVhIGJlZW4gc2VydmVkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzQm9vbGVhblxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNCb29sZWFuID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYSgnYm9vbGVhbicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90Qm9vbGVhbih2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyBfbm90XyBhIGJvb2xlYW4uXG4gICAqXG4gICAqICAgICB2YXIgdGVhUmVhZHkgPSAneWVwJ1xuICAgKiAgICAgICAsIHRlYVNlcnZlZCA9ICdub3BlJztcbiAgICpcbiAgICogICAgIGFzc2VydC5pc05vdEJvb2xlYW4odGVhUmVhZHksICdpcyB0aGUgdGVhIHJlYWR5Jyk7XG4gICAqICAgICBhc3NlcnQuaXNOb3RCb29sZWFuKHRlYVNlcnZlZCwgJ2hhcyB0ZWEgYmVlbiBzZXJ2ZWQnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3RCb29sZWFuXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc05vdEJvb2xlYW4gPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuYmUuYSgnYm9vbGVhbicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLnR5cGVPZih2YWx1ZSwgbmFtZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCdzIHR5cGUgaXMgYG5hbWVgLCBhcyBkZXRlcm1pbmVkIGJ5XG4gICAqIGBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nYC5cbiAgICpcbiAgICogICAgIGFzc2VydC50eXBlT2YoeyB0ZWE6ICdjaGFpJyB9LCAnb2JqZWN0JywgJ3dlIGhhdmUgYW4gb2JqZWN0Jyk7XG4gICAqICAgICBhc3NlcnQudHlwZU9mKFsnY2hhaScsICdqYXNtaW5lJ10sICdhcnJheScsICd3ZSBoYXZlIGFuIGFycmF5Jyk7XG4gICAqICAgICBhc3NlcnQudHlwZU9mKCd0ZWEnLCAnc3RyaW5nJywgJ3dlIGhhdmUgYSBzdHJpbmcnKTtcbiAgICogICAgIGFzc2VydC50eXBlT2YoL3RlYS8sICdyZWdleHAnLCAnd2UgaGF2ZSBhIHJlZ3VsYXIgZXhwcmVzc2lvbicpO1xuICAgKiAgICAgYXNzZXJ0LnR5cGVPZihudWxsLCAnbnVsbCcsICd3ZSBoYXZlIGEgbnVsbCcpO1xuICAgKiAgICAgYXNzZXJ0LnR5cGVPZih1bmRlZmluZWQsICd1bmRlZmluZWQnLCAnd2UgaGF2ZSBhbiB1bmRlZmluZWQnKTtcbiAgICpcbiAgICogQG5hbWUgdHlwZU9mXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC50eXBlT2YgPSBmdW5jdGlvbiAodmFsLCB0eXBlLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5iZS5hKHR5cGUpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdFR5cGVPZih2YWx1ZSwgbmFtZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCdzIHR5cGUgaXMgX25vdF8gYG5hbWVgLCBhcyBkZXRlcm1pbmVkIGJ5XG4gICAqIGBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RUeXBlT2YoJ3RlYScsICdudW1iZXInLCAnc3RyaW5ncyBhcmUgbm90IG51bWJlcnMnKTtcbiAgICpcbiAgICogQG5hbWUgbm90VHlwZU9mXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlb2YgbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubm90VHlwZU9mID0gZnVuY3Rpb24gKHZhbCwgdHlwZSwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmEodHlwZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaW5zdGFuY2VPZihvYmplY3QsIGNvbnN0cnVjdG9yLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIGFuIGluc3RhbmNlIG9mIGBjb25zdHJ1Y3RvcmAuXG4gICAqXG4gICAqICAgICB2YXIgVGVhID0gZnVuY3Rpb24gKG5hbWUpIHsgdGhpcy5uYW1lID0gbmFtZTsgfVxuICAgKiAgICAgICAsIGNoYWkgPSBuZXcgVGVhKCdjaGFpJyk7XG4gICAqXG4gICAqICAgICBhc3NlcnQuaW5zdGFuY2VPZihjaGFpLCBUZWEsICdjaGFpIGlzIGFuIGluc3RhbmNlIG9mIHRlYScpO1xuICAgKlxuICAgKiBAbmFtZSBpbnN0YW5jZU9mXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtDb25zdHJ1Y3Rvcn0gY29uc3RydWN0b3JcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lmluc3RhbmNlT2YgPSBmdW5jdGlvbiAodmFsLCB0eXBlLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5iZS5pbnN0YW5jZU9mKHR5cGUpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdEluc3RhbmNlT2Yob2JqZWN0LCBjb25zdHJ1Y3RvciwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIGB2YWx1ZWAgaXMgbm90IGFuIGluc3RhbmNlIG9mIGBjb25zdHJ1Y3RvcmAuXG4gICAqXG4gICAqICAgICB2YXIgVGVhID0gZnVuY3Rpb24gKG5hbWUpIHsgdGhpcy5uYW1lID0gbmFtZTsgfVxuICAgKiAgICAgICAsIGNoYWkgPSBuZXcgU3RyaW5nKCdjaGFpJyk7XG4gICAqXG4gICAqICAgICBhc3NlcnQubm90SW5zdGFuY2VPZihjaGFpLCBUZWEsICdjaGFpIGlzIG5vdCBhbiBpbnN0YW5jZSBvZiB0ZWEnKTtcbiAgICpcbiAgICogQG5hbWUgbm90SW5zdGFuY2VPZlxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7Q29uc3RydWN0b3J9IGNvbnN0cnVjdG9yXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5ub3RJbnN0YW5jZU9mID0gZnVuY3Rpb24gKHZhbCwgdHlwZSwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmluc3RhbmNlT2YodHlwZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaW5jbHVkZShoYXlzdGFjaywgbmVlZGxlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgaGF5c3RhY2tgIGluY2x1ZGVzIGBuZWVkbGVgLiBXb3Jrc1xuICAgKiBmb3Igc3RyaW5ncyBhbmQgYXJyYXlzLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmluY2x1ZGUoJ2Zvb2JhcicsICdiYXInLCAnZm9vYmFyIGNvbnRhaW5zIHN0cmluZyBcImJhclwiJyk7XG4gICAqICAgICBhc3NlcnQuaW5jbHVkZShbIDEsIDIsIDMgXSwgMywgJ2FycmF5IGNvbnRhaW5zIHZhbHVlJyk7XG4gICAqXG4gICAqIEBuYW1lIGluY2x1ZGVcbiAgICogQHBhcmFtIHtBcnJheXxTdHJpbmd9IGhheXN0YWNrXG4gICAqIEBwYXJhbSB7TWl4ZWR9IG5lZWRsZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaW5jbHVkZSA9IGZ1bmN0aW9uIChleHAsIGluYywgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihleHAsIG1zZywgYXNzZXJ0LmluY2x1ZGUpLmluY2x1ZGUoaW5jKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3RJbmNsdWRlKGhheXN0YWNrLCBuZWVkbGUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBoYXlzdGFja2AgZG9lcyBub3QgaW5jbHVkZSBgbmVlZGxlYC4gV29ya3NcbiAgICogZm9yIHN0cmluZ3MgYW5kIGFycmF5cy5cbiAgICppXG4gICAqICAgICBhc3NlcnQubm90SW5jbHVkZSgnZm9vYmFyJywgJ2JheicsICdzdHJpbmcgbm90IGluY2x1ZGUgc3Vic3RyaW5nJyk7XG4gICAqICAgICBhc3NlcnQubm90SW5jbHVkZShbIDEsIDIsIDMgXSwgNCwgJ2FycmF5IG5vdCBpbmNsdWRlIGNvbnRhaW4gdmFsdWUnKTtcbiAgICpcbiAgICogQG5hbWUgbm90SW5jbHVkZVxuICAgKiBAcGFyYW0ge0FycmF5fFN0cmluZ30gaGF5c3RhY2tcbiAgICogQHBhcmFtIHtNaXhlZH0gbmVlZGxlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5ub3RJbmNsdWRlID0gZnVuY3Rpb24gKGV4cCwgaW5jLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGV4cCwgbXNnLCBhc3NlcnQubm90SW5jbHVkZSkubm90LmluY2x1ZGUoaW5jKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5tYXRjaCh2YWx1ZSwgcmVnZXhwLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIG1hdGNoZXMgdGhlIHJlZ3VsYXIgZXhwcmVzc2lvbiBgcmVnZXhwYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5tYXRjaCgnZm9vYmFyJywgL15mb28vLCAncmVnZXhwIG1hdGNoZXMnKTtcbiAgICpcbiAgICogQG5hbWUgbWF0Y2hcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtSZWdFeHB9IHJlZ2V4cFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubWF0Y2ggPSBmdW5jdGlvbiAoZXhwLCByZSwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihleHAsIG1zZykudG8ubWF0Y2gocmUpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdE1hdGNoKHZhbHVlLCByZWdleHAsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgZG9lcyBub3QgbWF0Y2ggdGhlIHJlZ3VsYXIgZXhwcmVzc2lvbiBgcmVnZXhwYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RNYXRjaCgnZm9vYmFyJywgL15mb28vLCAncmVnZXhwIGRvZXMgbm90IG1hdGNoJyk7XG4gICAqXG4gICAqIEBuYW1lIG5vdE1hdGNoXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7UmVnRXhwfSByZWdleHBcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdE1hdGNoID0gZnVuY3Rpb24gKGV4cCwgcmUsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24oZXhwLCBtc2cpLnRvLm5vdC5tYXRjaChyZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAucHJvcGVydHkob2JqZWN0LCBwcm9wZXJ0eSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgcHJvcGVydHkgbmFtZWQgYnkgYHByb3BlcnR5YC5cbiAgICpcbiAgICogICAgIGFzc2VydC5wcm9wZXJ0eSh7IHRlYTogeyBncmVlbjogJ21hdGNoYScgfX0sICd0ZWEnKTtcbiAgICpcbiAgICogQG5hbWUgcHJvcGVydHlcbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHlcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LnByb3BlcnR5ID0gZnVuY3Rpb24gKG9iaiwgcHJvcCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihvYmosIG1zZykudG8uaGF2ZS5wcm9wZXJ0eShwcm9wKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3RQcm9wZXJ0eShvYmplY3QsIHByb3BlcnR5LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgb2JqZWN0YCBkb2VzIF9ub3RfIGhhdmUgYSBwcm9wZXJ0eSBuYW1lZCBieSBgcHJvcGVydHlgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0Lm5vdFByb3BlcnR5KHsgdGVhOiB7IGdyZWVuOiAnbWF0Y2hhJyB9fSwgJ2NvZmZlZScpO1xuICAgKlxuICAgKiBAbmFtZSBub3RQcm9wZXJ0eVxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wZXJ0eVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubm90UHJvcGVydHkgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKG9iaiwgbXNnKS50by5ub3QuaGF2ZS5wcm9wZXJ0eShwcm9wKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5kZWVwUHJvcGVydHkob2JqZWN0LCBwcm9wZXJ0eSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgcHJvcGVydHkgbmFtZWQgYnkgYHByb3BlcnR5YCwgd2hpY2ggY2FuIGJlIGFcbiAgICogc3RyaW5nIHVzaW5nIGRvdC0gYW5kIGJyYWNrZXQtbm90YXRpb24gZm9yIGRlZXAgcmVmZXJlbmNlLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmRlZXBQcm9wZXJ0eSh7IHRlYTogeyBncmVlbjogJ21hdGNoYScgfX0sICd0ZWEuZ3JlZW4nKTtcbiAgICpcbiAgICogQG5hbWUgZGVlcFByb3BlcnR5XG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWVwUHJvcGVydHkgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKG9iaiwgbXNnKS50by5oYXZlLmRlZXAucHJvcGVydHkocHJvcCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAubm90RGVlcFByb3BlcnR5KG9iamVjdCwgcHJvcGVydHksIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBvYmplY3RgIGRvZXMgX25vdF8gaGF2ZSBhIHByb3BlcnR5IG5hbWVkIGJ5IGBwcm9wZXJ0eWAsIHdoaWNoXG4gICAqIGNhbiBiZSBhIHN0cmluZyB1c2luZyBkb3QtIGFuZCBicmFja2V0LW5vdGF0aW9uIGZvciBkZWVwIHJlZmVyZW5jZS5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3REZWVwUHJvcGVydHkoeyB0ZWE6IHsgZ3JlZW46ICdtYXRjaGEnIH19LCAndGVhLm9vbG9uZycpO1xuICAgKlxuICAgKiBAbmFtZSBub3REZWVwUHJvcGVydHlcbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHlcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdERlZXBQcm9wZXJ0eSA9IGZ1bmN0aW9uIChvYmosIHByb3AsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24ob2JqLCBtc2cpLnRvLm5vdC5oYXZlLmRlZXAucHJvcGVydHkocHJvcCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAucHJvcGVydHlWYWwob2JqZWN0LCBwcm9wZXJ0eSwgdmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBvYmplY3RgIGhhcyBhIHByb3BlcnR5IG5hbWVkIGJ5IGBwcm9wZXJ0eWAgd2l0aCB2YWx1ZSBnaXZlblxuICAgKiBieSBgdmFsdWVgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LnByb3BlcnR5VmFsKHsgdGVhOiAnaXMgZ29vZCcgfSwgJ3RlYScsICdpcyBnb29kJyk7XG4gICAqXG4gICAqIEBuYW1lIHByb3BlcnR5VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5wcm9wZXJ0eVZhbCA9IGZ1bmN0aW9uIChvYmosIHByb3AsIHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihvYmosIG1zZykudG8uaGF2ZS5wcm9wZXJ0eShwcm9wLCB2YWwpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLnByb3BlcnR5Tm90VmFsKG9iamVjdCwgcHJvcGVydHksIHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgb2JqZWN0YCBoYXMgYSBwcm9wZXJ0eSBuYW1lZCBieSBgcHJvcGVydHlgLCBidXQgd2l0aCBhIHZhbHVlXG4gICAqIGRpZmZlcmVudCBmcm9tIHRoYXQgZ2l2ZW4gYnkgYHZhbHVlYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5wcm9wZXJ0eU5vdFZhbCh7IHRlYTogJ2lzIGdvb2QnIH0sICd0ZWEnLCAnaXMgYmFkJyk7XG4gICAqXG4gICAqIEBuYW1lIHByb3BlcnR5Tm90VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5wcm9wZXJ0eU5vdFZhbCA9IGZ1bmN0aW9uIChvYmosIHByb3AsIHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihvYmosIG1zZykudG8ubm90LmhhdmUucHJvcGVydHkocHJvcCwgdmFsKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5kZWVwUHJvcGVydHlWYWwob2JqZWN0LCBwcm9wZXJ0eSwgdmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBvYmplY3RgIGhhcyBhIHByb3BlcnR5IG5hbWVkIGJ5IGBwcm9wZXJ0eWAgd2l0aCB2YWx1ZSBnaXZlblxuICAgKiBieSBgdmFsdWVgLiBgcHJvcGVydHlgIGNhbiB1c2UgZG90LSBhbmQgYnJhY2tldC1ub3RhdGlvbiBmb3IgZGVlcFxuICAgKiByZWZlcmVuY2UuXG4gICAqXG4gICAqICAgICBhc3NlcnQuZGVlcFByb3BlcnR5VmFsKHsgdGVhOiB7IGdyZWVuOiAnbWF0Y2hhJyB9fSwgJ3RlYS5ncmVlbicsICdtYXRjaGEnKTtcbiAgICpcbiAgICogQG5hbWUgZGVlcFByb3BlcnR5VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWVwUHJvcGVydHlWYWwgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCB2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24ob2JqLCBtc2cpLnRvLmhhdmUuZGVlcC5wcm9wZXJ0eShwcm9wLCB2YWwpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmRlZXBQcm9wZXJ0eU5vdFZhbChvYmplY3QsIHByb3BlcnR5LCB2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgcHJvcGVydHkgbmFtZWQgYnkgYHByb3BlcnR5YCwgYnV0IHdpdGggYSB2YWx1ZVxuICAgKiBkaWZmZXJlbnQgZnJvbSB0aGF0IGdpdmVuIGJ5IGB2YWx1ZWAuIGBwcm9wZXJ0eWAgY2FuIHVzZSBkb3QtIGFuZFxuICAgKiBicmFja2V0LW5vdGF0aW9uIGZvciBkZWVwIHJlZmVyZW5jZS5cbiAgICpcbiAgICogICAgIGFzc2VydC5kZWVwUHJvcGVydHlOb3RWYWwoeyB0ZWE6IHsgZ3JlZW46ICdtYXRjaGEnIH19LCAndGVhLmdyZWVuJywgJ2tvbmFjaGEnKTtcbiAgICpcbiAgICogQG5hbWUgZGVlcFByb3BlcnR5Tm90VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWVwUHJvcGVydHlOb3RWYWwgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCB2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24ob2JqLCBtc2cpLnRvLm5vdC5oYXZlLmRlZXAucHJvcGVydHkocHJvcCwgdmFsKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5sZW5ndGhPZihvYmplY3QsIGxlbmd0aCwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgYGxlbmd0aGAgcHJvcGVydHkgd2l0aCB0aGUgZXhwZWN0ZWQgdmFsdWUuXG4gICAqXG4gICAqICAgICBhc3NlcnQubGVuZ3RoT2YoWzEsMiwzXSwgMywgJ2FycmF5IGhhcyBsZW5ndGggb2YgMycpO1xuICAgKiAgICAgYXNzZXJ0Lmxlbmd0aE9mKCdmb29iYXInLCA1LCAnc3RyaW5nIGhhcyBsZW5ndGggb2YgNicpO1xuICAgKlxuICAgKiBAbmFtZSBsZW5ndGhPZlxuICAgKiBAcGFyYW0ge01peGVkfSBvYmplY3RcbiAgICogQHBhcmFtIHtOdW1iZXJ9IGxlbmd0aFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubGVuZ3RoT2YgPSBmdW5jdGlvbiAoZXhwLCBsZW4sIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24oZXhwLCBtc2cpLnRvLmhhdmUubGVuZ3RoKGxlbik7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAudGhyb3dzKGZ1bmN0aW9uLCBbY29uc3RydWN0b3Ivc3RyaW5nL3JlZ2V4cF0sIFtzdHJpbmcvcmVnZXhwXSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYGZ1bmN0aW9uYCB3aWxsIHRocm93IGFuIGVycm9yIHRoYXQgaXMgYW4gaW5zdGFuY2Ugb2ZcbiAgICogYGNvbnN0cnVjdG9yYCwgb3IgYWx0ZXJuYXRlbHkgdGhhdCBpdCB3aWxsIHRocm93IGFuIGVycm9yIHdpdGggbWVzc2FnZVxuICAgKiBtYXRjaGluZyBgcmVnZXhwYC5cbiAgICpcbiAgICogICAgIGFzc2VydC50aHJvdyhmbiwgJ2Z1bmN0aW9uIHRocm93cyBhIHJlZmVyZW5jZSBlcnJvcicpO1xuICAgKiAgICAgYXNzZXJ0LnRocm93KGZuLCAvZnVuY3Rpb24gdGhyb3dzIGEgcmVmZXJlbmNlIGVycm9yLyk7XG4gICAqICAgICBhc3NlcnQudGhyb3coZm4sIFJlZmVyZW5jZUVycm9yKTtcbiAgICogICAgIGFzc2VydC50aHJvdyhmbiwgUmVmZXJlbmNlRXJyb3IsICdmdW5jdGlvbiB0aHJvd3MgYSByZWZlcmVuY2UgZXJyb3InKTtcbiAgICogICAgIGFzc2VydC50aHJvdyhmbiwgUmVmZXJlbmNlRXJyb3IsIC9mdW5jdGlvbiB0aHJvd3MgYSByZWZlcmVuY2UgZXJyb3IvKTtcbiAgICpcbiAgICogQG5hbWUgdGhyb3dzXG4gICAqIEBhbGlhcyB0aHJvd1xuICAgKiBAYWxpYXMgVGhyb3dcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuY3Rpb25cbiAgICogQHBhcmFtIHtFcnJvckNvbnN0cnVjdG9yfSBjb25zdHJ1Y3RvclxuICAgKiBAcGFyYW0ge1JlZ0V4cH0gcmVnZXhwXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBzZWUgaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4vSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvRXJyb3IjRXJyb3JfdHlwZXNcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LlRocm93ID0gZnVuY3Rpb24gKGZuLCBlcnJ0LCBlcnJzLCBtc2cpIHtcbiAgICBpZiAoJ3N0cmluZycgPT09IHR5cGVvZiBlcnJ0IHx8IGVycnQgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIGVycnMgPSBlcnJ0O1xuICAgICAgZXJydCA9IG51bGw7XG4gICAgfVxuXG4gICAgdmFyIGFzc2VydEVyciA9IG5ldyBBc3NlcnRpb24oZm4sIG1zZykudG8uVGhyb3coZXJydCwgZXJycyk7XG4gICAgcmV0dXJuIGZsYWcoYXNzZXJ0RXJyLCAnb2JqZWN0Jyk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuZG9lc05vdFRocm93KGZ1bmN0aW9uLCBbY29uc3RydWN0b3IvcmVnZXhwXSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYGZ1bmN0aW9uYCB3aWxsIF9ub3RfIHRocm93IGFuIGVycm9yIHRoYXQgaXMgYW4gaW5zdGFuY2Ugb2ZcbiAgICogYGNvbnN0cnVjdG9yYCwgb3IgYWx0ZXJuYXRlbHkgdGhhdCBpdCB3aWxsIG5vdCB0aHJvdyBhbiBlcnJvciB3aXRoIG1lc3NhZ2VcbiAgICogbWF0Y2hpbmcgYHJlZ2V4cGAuXG4gICAqXG4gICAqICAgICBhc3NlcnQuZG9lc05vdFRocm93KGZuLCBFcnJvciwgJ2Z1bmN0aW9uIGRvZXMgbm90IHRocm93Jyk7XG4gICAqXG4gICAqIEBuYW1lIGRvZXNOb3RUaHJvd1xuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jdGlvblxuICAgKiBAcGFyYW0ge0Vycm9yQ29uc3RydWN0b3J9IGNvbnN0cnVjdG9yXG4gICAqIEBwYXJhbSB7UmVnRXhwfSByZWdleHBcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQHNlZSBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9FcnJvciNFcnJvcl90eXBlc1xuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZG9lc05vdFRocm93ID0gZnVuY3Rpb24gKGZuLCB0eXBlLCBtc2cpIHtcbiAgICBpZiAoJ3N0cmluZycgPT09IHR5cGVvZiB0eXBlKSB7XG4gICAgICBtc2cgPSB0eXBlO1xuICAgICAgdHlwZSA9IG51bGw7XG4gICAgfVxuXG4gICAgbmV3IEFzc2VydGlvbihmbiwgbXNnKS50by5ub3QuVGhyb3codHlwZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAub3BlcmF0b3IodmFsMSwgb3BlcmF0b3IsIHZhbDIsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQ29tcGFyZXMgdHdvIHZhbHVlcyB1c2luZyBgb3BlcmF0b3JgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0Lm9wZXJhdG9yKDEsICc8JywgMiwgJ2V2ZXJ5dGhpbmcgaXMgb2snKTtcbiAgICogICAgIGFzc2VydC5vcGVyYXRvcigxLCAnPicsIDIsICd0aGlzIHdpbGwgZmFpbCcpO1xuICAgKlxuICAgKiBAbmFtZSBvcGVyYXRvclxuICAgKiBAcGFyYW0ge01peGVkfSB2YWwxXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBvcGVyYXRvclxuICAgKiBAcGFyYW0ge01peGVkfSB2YWwyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5vcGVyYXRvciA9IGZ1bmN0aW9uICh2YWwsIG9wZXJhdG9yLCB2YWwyLCBtc2cpIHtcbiAgICB2YXIgb2s7XG4gICAgc3dpdGNoKG9wZXJhdG9yKSB7XG4gICAgICBjYXNlICc9PSc6XG4gICAgICAgIG9rID0gdmFsID09IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnPT09JzpcbiAgICAgICAgb2sgPSB2YWwgPT09IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnPic6XG4gICAgICAgIG9rID0gdmFsID4gdmFsMjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICc+PSc6XG4gICAgICAgIG9rID0gdmFsID49IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnPCc6XG4gICAgICAgIG9rID0gdmFsIDwgdmFsMjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICc8PSc6XG4gICAgICAgIG9rID0gdmFsIDw9IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnIT0nOlxuICAgICAgICBvayA9IHZhbCAhPSB2YWwyO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJyE9PSc6XG4gICAgICAgIG9rID0gdmFsICE9PSB2YWwyO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBvcGVyYXRvciBcIicgKyBvcGVyYXRvciArICdcIicpO1xuICAgIH1cbiAgICB2YXIgdGVzdCA9IG5ldyBBc3NlcnRpb24ob2ssIG1zZyk7XG4gICAgdGVzdC5hc3NlcnQoXG4gICAgICAgIHRydWUgPT09IGZsYWcodGVzdCwgJ29iamVjdCcpXG4gICAgICAsICdleHBlY3RlZCAnICsgdXRpbC5pbnNwZWN0KHZhbCkgKyAnIHRvIGJlICcgKyBvcGVyYXRvciArICcgJyArIHV0aWwuaW5zcGVjdCh2YWwyKVxuICAgICAgLCAnZXhwZWN0ZWQgJyArIHV0aWwuaW5zcGVjdCh2YWwpICsgJyB0byBub3QgYmUgJyArIG9wZXJhdG9yICsgJyAnICsgdXRpbC5pbnNwZWN0KHZhbDIpICk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuY2xvc2VUbyhhY3R1YWwsIGV4cGVjdGVkLCBkZWx0YSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgdGhlIHRhcmdldCBpcyBlcXVhbCBgZXhwZWN0ZWRgLCB0byB3aXRoaW4gYSArLy0gYGRlbHRhYCByYW5nZS5cbiAgICpcbiAgICogICAgIGFzc2VydC5jbG9zZVRvKDEuNSwgMSwgMC41LCAnbnVtYmVycyBhcmUgY2xvc2UnKTtcbiAgICpcbiAgICogQG5hbWUgY2xvc2VUb1xuICAgKiBAcGFyYW0ge051bWJlcn0gYWN0dWFsXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge051bWJlcn0gZGVsdGFcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmNsb3NlVG8gPSBmdW5jdGlvbiAoYWN0LCBleHAsIGRlbHRhLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGFjdCwgbXNnKS50by5iZS5jbG9zZVRvKGV4cCwgZGVsdGEpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLnNhbWVNZW1iZXJzKHNldDEsIHNldDIsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBzZXQxYCBhbmQgYHNldDJgIGhhdmUgdGhlIHNhbWUgbWVtYmVycy5cbiAgICogT3JkZXIgaXMgbm90IHRha2VuIGludG8gYWNjb3VudC5cbiAgICpcbiAgICogICAgIGFzc2VydC5zYW1lTWVtYmVycyhbIDEsIDIsIDMgXSwgWyAyLCAxLCAzIF0sICdzYW1lIG1lbWJlcnMnKTtcbiAgICpcbiAgICogQG5hbWUgc2FtZU1lbWJlcnNcbiAgICogQHBhcmFtIHtBcnJheX0gc2V0MVxuICAgKiBAcGFyYW0ge0FycmF5fSBzZXQyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5zYW1lTWVtYmVycyA9IGZ1bmN0aW9uIChzZXQxLCBzZXQyLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHNldDEsIG1zZykudG8uaGF2ZS5zYW1lLm1lbWJlcnMoc2V0Mik7XG4gIH1cblxuICAvKipcbiAgICogIyMjIC5zYW1lRGVlcE1lbWJlcnMoc2V0MSwgc2V0MiwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHNldDFgIGFuZCBgc2V0MmAgaGF2ZSB0aGUgc2FtZSBtZW1iZXJzIC0gdXNpbmcgYSBkZWVwIGVxdWFsaXR5IGNoZWNraW5nLlxuICAgKiBPcmRlciBpcyBub3QgdGFrZW4gaW50byBhY2NvdW50LlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LnNhbWVEZWVwTWVtYmVycyhbIHtiOiAzfSwge2E6IDJ9LCB7YzogNX0gXSwgWyB7YzogNX0sIHtiOiAzfSwge2E6IDJ9IF0sICdzYW1lIGRlZXAgbWVtYmVycycpO1xuICAgKlxuICAgKiBAbmFtZSBzYW1lRGVlcE1lbWJlcnNcbiAgICogQHBhcmFtIHtBcnJheX0gc2V0MVxuICAgKiBAcGFyYW0ge0FycmF5fSBzZXQyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5zYW1lRGVlcE1lbWJlcnMgPSBmdW5jdGlvbiAoc2V0MSwgc2V0MiwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihzZXQxLCBtc2cpLnRvLmhhdmUuc2FtZS5kZWVwLm1lbWJlcnMoc2V0Mik7XG4gIH1cblxuICAvKipcbiAgICogIyMjIC5pbmNsdWRlTWVtYmVycyhzdXBlcnNldCwgc3Vic2V0LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgc3Vic2V0YCBpcyBpbmNsdWRlZCBpbiBgc3VwZXJzZXRgLlxuICAgKiBPcmRlciBpcyBub3QgdGFrZW4gaW50byBhY2NvdW50LlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmluY2x1ZGVNZW1iZXJzKFsgMSwgMiwgMyBdLCBbIDIsIDEgXSwgJ2luY2x1ZGUgbWVtYmVycycpO1xuICAgKlxuICAgKiBAbmFtZSBpbmNsdWRlTWVtYmVyc1xuICAgKiBAcGFyYW0ge0FycmF5fSBzdXBlcnNldFxuICAgKiBAcGFyYW0ge0FycmF5fSBzdWJzZXRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmluY2x1ZGVNZW1iZXJzID0gZnVuY3Rpb24gKHN1cGVyc2V0LCBzdWJzZXQsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24oc3VwZXJzZXQsIG1zZykudG8uaW5jbHVkZS5tZW1iZXJzKHN1YnNldCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuY2hhbmdlcyhmdW5jdGlvbiwgb2JqZWN0LCBwcm9wZXJ0eSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGEgZnVuY3Rpb24gY2hhbmdlcyB0aGUgdmFsdWUgb2YgYSBwcm9wZXJ0eVxuICAgKlxuICAgKiAgICAgdmFyIG9iaiA9IHsgdmFsOiAxMCB9O1xuICAgKiAgICAgdmFyIGZuID0gZnVuY3Rpb24oKSB7IG9iai52YWwgPSAyMiB9O1xuICAgKiAgICAgYXNzZXJ0LmNoYW5nZXMoZm4sIG9iaiwgJ3ZhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBjaGFuZ2VzXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG1vZGlmaWVyIGZ1bmN0aW9uXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5IG5hbWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2UgX29wdGlvbmFsX1xuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuY2hhbmdlcyA9IGZ1bmN0aW9uIChmbiwgb2JqLCBwcm9wKSB7XG4gICAgbmV3IEFzc2VydGlvbihmbikudG8uY2hhbmdlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZG9lc05vdENoYW5nZShmdW5jdGlvbiwgb2JqZWN0LCBwcm9wZXJ0eSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGEgZnVuY3Rpb24gZG9lcyBub3QgY2hhbmdlcyB0aGUgdmFsdWUgb2YgYSBwcm9wZXJ0eVxuICAgKlxuICAgKiAgICAgdmFyIG9iaiA9IHsgdmFsOiAxMCB9O1xuICAgKiAgICAgdmFyIGZuID0gZnVuY3Rpb24oKSB7IGNvbnNvbGUubG9nKCdmb28nKTsgfTtcbiAgICogICAgIGFzc2VydC5kb2VzTm90Q2hhbmdlKGZuLCBvYmosICd2YWwnKTtcbiAgICpcbiAgICogQG5hbWUgZG9lc05vdENoYW5nZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBtb2RpZmllciBmdW5jdGlvblxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wZXJ0eSBuYW1lXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlIF9vcHRpb25hbF9cbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmRvZXNOb3RDaGFuZ2UgPSBmdW5jdGlvbiAoZm4sIG9iaiwgcHJvcCkge1xuICAgIG5ldyBBc3NlcnRpb24oZm4pLnRvLm5vdC5jaGFuZ2Uob2JqLCBwcm9wKTtcbiAgfVxuXG4gICAvKipcbiAgICogIyMjIC5pbmNyZWFzZXMoZnVuY3Rpb24sIG9iamVjdCwgcHJvcGVydHkpXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBhIGZ1bmN0aW9uIGluY3JlYXNlcyBhbiBvYmplY3QgcHJvcGVydHlcbiAgICpcbiAgICogICAgIHZhciBvYmogPSB7IHZhbDogMTAgfTtcbiAgICogICAgIHZhciBmbiA9IGZ1bmN0aW9uKCkgeyBvYmoudmFsID0gMTMgfTtcbiAgICogICAgIGFzc2VydC5pbmNyZWFzZXMoZm4sIG9iaiwgJ3ZhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBpbmNyZWFzZXNcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbW9kaWZpZXIgZnVuY3Rpb25cbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHkgbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZSBfb3B0aW9uYWxfXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pbmNyZWFzZXMgPSBmdW5jdGlvbiAoZm4sIG9iaiwgcHJvcCkge1xuICAgIG5ldyBBc3NlcnRpb24oZm4pLnRvLmluY3JlYXNlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZG9lc05vdEluY3JlYXNlKGZ1bmN0aW9uLCBvYmplY3QsIHByb3BlcnR5KVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYSBmdW5jdGlvbiBkb2VzIG5vdCBpbmNyZWFzZSBvYmplY3QgcHJvcGVydHlcbiAgICpcbiAgICogICAgIHZhciBvYmogPSB7IHZhbDogMTAgfTtcbiAgICogICAgIHZhciBmbiA9IGZ1bmN0aW9uKCkgeyBvYmoudmFsID0gOCB9O1xuICAgKiAgICAgYXNzZXJ0LmRvZXNOb3RJbmNyZWFzZShmbiwgb2JqLCAndmFsJyk7XG4gICAqXG4gICAqIEBuYW1lIGRvZXNOb3RJbmNyZWFzZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBtb2RpZmllciBmdW5jdGlvblxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wZXJ0eSBuYW1lXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlIF9vcHRpb25hbF9cbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmRvZXNOb3RJbmNyZWFzZSA9IGZ1bmN0aW9uIChmbiwgb2JqLCBwcm9wKSB7XG4gICAgbmV3IEFzc2VydGlvbihmbikudG8ubm90LmluY3JlYXNlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZGVjcmVhc2VzKGZ1bmN0aW9uLCBvYmplY3QsIHByb3BlcnR5KVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYSBmdW5jdGlvbiBkZWNyZWFzZXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gICAqXG4gICAqICAgICB2YXIgb2JqID0geyB2YWw6IDEwIH07XG4gICAqICAgICB2YXIgZm4gPSBmdW5jdGlvbigpIHsgb2JqLnZhbCA9IDUgfTtcbiAgICogICAgIGFzc2VydC5kZWNyZWFzZXMoZm4sIG9iaiwgJ3ZhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBkZWNyZWFzZXNcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbW9kaWZpZXIgZnVuY3Rpb25cbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHkgbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZSBfb3B0aW9uYWxfXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWNyZWFzZXMgPSBmdW5jdGlvbiAoZm4sIG9iaiwgcHJvcCkge1xuICAgIG5ldyBBc3NlcnRpb24oZm4pLnRvLmRlY3JlYXNlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZG9lc05vdERlY3JlYXNlKGZ1bmN0aW9uLCBvYmplY3QsIHByb3BlcnR5KVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYSBmdW5jdGlvbiBkb2VzIG5vdCBkZWNyZWFzZXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gICAqXG4gICAqICAgICB2YXIgb2JqID0geyB2YWw6IDEwIH07XG4gICAqICAgICB2YXIgZm4gPSBmdW5jdGlvbigpIHsgb2JqLnZhbCA9IDE1IH07XG4gICAqICAgICBhc3NlcnQuZG9lc05vdERlY3JlYXNlKGZuLCBvYmosICd2YWwnKTtcbiAgICpcbiAgICogQG5hbWUgZG9lc05vdERlY3JlYXNlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG1vZGlmaWVyIGZ1bmN0aW9uXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5IG5hbWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2UgX29wdGlvbmFsX1xuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZG9lc05vdERlY3JlYXNlID0gZnVuY3Rpb24gKGZuLCBvYmosIHByb3ApIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGZuKS50by5ub3QuZGVjcmVhc2Uob2JqLCBwcm9wKTtcbiAgfVxuXG4gIC8qIVxuICAgKiBVbmRvY3VtZW50ZWQgLyB1bnRlc3RlZFxuICAgKi9cblxuICBhc3NlcnQuaWZFcnJvciA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLm5vdC5iZS5vaztcbiAgfTtcblxuICAvKiFcbiAgICogQWxpYXNlcy5cbiAgICovXG5cbiAgKGZ1bmN0aW9uIGFsaWFzKG5hbWUsIGFzKXtcbiAgICBhc3NlcnRbYXNdID0gYXNzZXJ0W25hbWVdO1xuICAgIHJldHVybiBhbGlhcztcbiAgfSlcbiAgKCdUaHJvdycsICd0aHJvdycpXG4gICgnVGhyb3cnLCAndGhyb3dzJyk7XG59O1xuIiwiLyohXG4gKiBjaGFpXG4gKiBDb3B5cmlnaHQoYykgMjAxMS0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY2hhaSwgdXRpbCkge1xuICBjaGFpLmV4cGVjdCA9IGZ1bmN0aW9uICh2YWwsIG1lc3NhZ2UpIHtcbiAgICByZXR1cm4gbmV3IGNoYWkuQXNzZXJ0aW9uKHZhbCwgbWVzc2FnZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBbbWVzc2FnZV0sIFtvcGVyYXRvcl0pXG4gICAqXG4gICAqIFRocm93IGEgZmFpbHVyZS5cbiAgICpcbiAgICogQG5hbWUgZmFpbFxuICAgKiBAcGFyYW0ge01peGVkfSBhY3R1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gZXhwZWN0ZWRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQHBhcmFtIHtTdHJpbmd9IG9wZXJhdG9yXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGNoYWkuZXhwZWN0LmZhaWwgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgb3BlcmF0b3IpIHtcbiAgICBtZXNzYWdlID0gbWVzc2FnZSB8fCAnZXhwZWN0LmZhaWwoKSc7XG4gICAgdGhyb3cgbmV3IGNoYWkuQXNzZXJ0aW9uRXJyb3IobWVzc2FnZSwge1xuICAgICAgICBhY3R1YWw6IGFjdHVhbFxuICAgICAgLCBleHBlY3RlZDogZXhwZWN0ZWRcbiAgICAgICwgb3BlcmF0b3I6IG9wZXJhdG9yXG4gICAgfSwgY2hhaS5leHBlY3QuZmFpbCk7XG4gIH07XG59O1xuIiwiLyohXG4gKiBjaGFpXG4gKiBDb3B5cmlnaHQoYykgMjAxMS0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY2hhaSwgdXRpbCkge1xuICB2YXIgQXNzZXJ0aW9uID0gY2hhaS5Bc3NlcnRpb247XG5cbiAgZnVuY3Rpb24gbG9hZFNob3VsZCAoKSB7XG4gICAgLy8gZXhwbGljaXRseSBkZWZpbmUgdGhpcyBtZXRob2QgYXMgZnVuY3Rpb24gYXMgdG8gaGF2ZSBpdCdzIG5hbWUgdG8gaW5jbHVkZSBhcyBgc3NmaWBcbiAgICBmdW5jdGlvbiBzaG91bGRHZXR0ZXIoKSB7XG4gICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIFN0cmluZyB8fCB0aGlzIGluc3RhbmNlb2YgTnVtYmVyIHx8IHRoaXMgaW5zdGFuY2VvZiBCb29sZWFuICkge1xuICAgICAgICByZXR1cm4gbmV3IEFzc2VydGlvbih0aGlzLnZhbHVlT2YoKSwgbnVsbCwgc2hvdWxkR2V0dGVyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgQXNzZXJ0aW9uKHRoaXMsIG51bGwsIHNob3VsZEdldHRlcik7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHNob3VsZFNldHRlcih2YWx1ZSkge1xuICAgICAgLy8gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9jaGFpanMvY2hhaS9pc3N1ZXMvODY6IHRoaXMgbWFrZXNcbiAgICAgIC8vIGB3aGF0ZXZlci5zaG91bGQgPSBzb21lVmFsdWVgIGFjdHVhbGx5IHNldCBgc29tZVZhbHVlYCwgd2hpY2ggaXNcbiAgICAgIC8vIGVzcGVjaWFsbHkgdXNlZnVsIGZvciBgZ2xvYmFsLnNob3VsZCA9IHJlcXVpcmUoJ2NoYWknKS5zaG91bGQoKWAuXG4gICAgICAvL1xuICAgICAgLy8gTm90ZSB0aGF0IHdlIGhhdmUgdG8gdXNlIFtbRGVmaW5lUHJvcGVydHldXSBpbnN0ZWFkIG9mIFtbUHV0XV1cbiAgICAgIC8vIHNpbmNlIG90aGVyd2lzZSB3ZSB3b3VsZCB0cmlnZ2VyIHRoaXMgdmVyeSBzZXR0ZXIhXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3Nob3VsZCcsIHtcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICAgIHdyaXRhYmxlOiB0cnVlXG4gICAgICB9KTtcbiAgICB9XG4gICAgLy8gbW9kaWZ5IE9iamVjdC5wcm90b3R5cGUgdG8gaGF2ZSBgc2hvdWxkYFxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShPYmplY3QucHJvdG90eXBlLCAnc2hvdWxkJywge1xuICAgICAgc2V0OiBzaG91bGRTZXR0ZXJcbiAgICAgICwgZ2V0OiBzaG91bGRHZXR0ZXJcbiAgICAgICwgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfSk7XG5cbiAgICB2YXIgc2hvdWxkID0ge307XG5cbiAgICAvKipcbiAgICAgKiAjIyMgLmZhaWwoYWN0dWFsLCBleHBlY3RlZCwgW21lc3NhZ2VdLCBbb3BlcmF0b3JdKVxuICAgICAqXG4gICAgICogVGhyb3cgYSBmYWlsdXJlLlxuICAgICAqXG4gICAgICogQG5hbWUgZmFpbFxuICAgICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgICAqIEBwYXJhbSB7TWl4ZWR9IGV4cGVjdGVkXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gb3BlcmF0b3JcbiAgICAgKiBAYXBpIHB1YmxpY1xuICAgICAqL1xuXG4gICAgc2hvdWxkLmZhaWwgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgb3BlcmF0b3IpIHtcbiAgICAgIG1lc3NhZ2UgPSBtZXNzYWdlIHx8ICdzaG91bGQuZmFpbCgpJztcbiAgICAgIHRocm93IG5ldyBjaGFpLkFzc2VydGlvbkVycm9yKG1lc3NhZ2UsIHtcbiAgICAgICAgICBhY3R1YWw6IGFjdHVhbFxuICAgICAgICAsIGV4cGVjdGVkOiBleHBlY3RlZFxuICAgICAgICAsIG9wZXJhdG9yOiBvcGVyYXRvclxuICAgICAgfSwgc2hvdWxkLmZhaWwpO1xuICAgIH07XG5cbiAgICBzaG91bGQuZXF1YWwgPSBmdW5jdGlvbiAodmFsMSwgdmFsMiwgbXNnKSB7XG4gICAgICBuZXcgQXNzZXJ0aW9uKHZhbDEsIG1zZykudG8uZXF1YWwodmFsMik7XG4gICAgfTtcblxuICAgIHNob3VsZC5UaHJvdyA9IGZ1bmN0aW9uIChmbiwgZXJydCwgZXJycywgbXNnKSB7XG4gICAgICBuZXcgQXNzZXJ0aW9uKGZuLCBtc2cpLnRvLlRocm93KGVycnQsIGVycnMpO1xuICAgIH07XG5cbiAgICBzaG91bGQuZXhpc3QgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmV4aXN0O1xuICAgIH1cblxuICAgIC8vIG5lZ2F0aW9uXG4gICAgc2hvdWxkLm5vdCA9IHt9XG5cbiAgICBzaG91bGQubm90LmVxdWFsID0gZnVuY3Rpb24gKHZhbDEsIHZhbDIsIG1zZykge1xuICAgICAgbmV3IEFzc2VydGlvbih2YWwxLCBtc2cpLnRvLm5vdC5lcXVhbCh2YWwyKTtcbiAgICB9O1xuXG4gICAgc2hvdWxkLm5vdC5UaHJvdyA9IGZ1bmN0aW9uIChmbiwgZXJydCwgZXJycywgbXNnKSB7XG4gICAgICBuZXcgQXNzZXJ0aW9uKGZuLCBtc2cpLnRvLm5vdC5UaHJvdyhlcnJ0LCBlcnJzKTtcbiAgICB9O1xuXG4gICAgc2hvdWxkLm5vdC5leGlzdCA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmV4aXN0O1xuICAgIH1cblxuICAgIHNob3VsZFsndGhyb3cnXSA9IHNob3VsZFsnVGhyb3cnXTtcbiAgICBzaG91bGQubm90Wyd0aHJvdyddID0gc2hvdWxkLm5vdFsnVGhyb3cnXTtcblxuICAgIHJldHVybiBzaG91bGQ7XG4gIH07XG5cbiAgY2hhaS5zaG91bGQgPSBsb2FkU2hvdWxkO1xuICBjaGFpLlNob3VsZCA9IGxvYWRTaG91bGQ7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gYWRkQ2hhaW5pbmdNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogTW9kdWxlIGRlcGVuZGVuY2llc1xuICovXG5cbnZhciB0cmFuc2ZlckZsYWdzID0gcmVxdWlyZSgnLi90cmFuc2ZlckZsYWdzJyk7XG52YXIgZmxhZyA9IHJlcXVpcmUoJy4vZmxhZycpO1xudmFyIGNvbmZpZyA9IHJlcXVpcmUoJy4uL2NvbmZpZycpO1xuXG4vKiFcbiAqIE1vZHVsZSB2YXJpYWJsZXNcbiAqL1xuXG4vLyBDaGVjayB3aGV0aGVyIGBfX3Byb3RvX19gIGlzIHN1cHBvcnRlZFxudmFyIGhhc1Byb3RvU3VwcG9ydCA9ICdfX3Byb3RvX18nIGluIE9iamVjdDtcblxuLy8gV2l0aG91dCBgX19wcm90b19fYCBzdXBwb3J0LCB0aGlzIG1vZHVsZSB3aWxsIG5lZWQgdG8gYWRkIHByb3BlcnRpZXMgdG8gYSBmdW5jdGlvbi5cbi8vIEhvd2V2ZXIsIHNvbWUgRnVuY3Rpb24ucHJvdG90eXBlIG1ldGhvZHMgY2Fubm90IGJlIG92ZXJ3cml0dGVuLFxuLy8gYW5kIHRoZXJlIHNlZW1zIG5vIGVhc3kgY3Jvc3MtcGxhdGZvcm0gd2F5IHRvIGRldGVjdCB0aGVtIChAc2VlIGNoYWlqcy9jaGFpL2lzc3Vlcy82OSkuXG52YXIgZXhjbHVkZU5hbWVzID0gL14oPzpsZW5ndGh8bmFtZXxhcmd1bWVudHN8Y2FsbGVyKSQvO1xuXG4vLyBDYWNoZSBgRnVuY3Rpb25gIHByb3BlcnRpZXNcbnZhciBjYWxsICA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsLFxuICAgIGFwcGx5ID0gRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5O1xuXG4vKipcbiAqICMjIyBhZGRDaGFpbmFibGVNZXRob2QgKGN0eCwgbmFtZSwgbWV0aG9kLCBjaGFpbmluZ0JlaGF2aW9yKVxuICpcbiAqIEFkZHMgYSBtZXRob2QgdG8gYW4gb2JqZWN0LCBzdWNoIHRoYXQgdGhlIG1ldGhvZCBjYW4gYWxzbyBiZSBjaGFpbmVkLlxuICpcbiAqICAgICB1dGlscy5hZGRDaGFpbmFibGVNZXRob2QoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnZm9vJywgZnVuY3Rpb24gKHN0cikge1xuICogICAgICAgdmFyIG9iaiA9IHV0aWxzLmZsYWcodGhpcywgJ29iamVjdCcpO1xuICogICAgICAgbmV3IGNoYWkuQXNzZXJ0aW9uKG9iaikudG8uYmUuZXF1YWwoc3RyKTtcbiAqICAgICB9KTtcbiAqXG4gKiBDYW4gYWxzbyBiZSBhY2Nlc3NlZCBkaXJlY3RseSBmcm9tIGBjaGFpLkFzc2VydGlvbmAuXG4gKlxuICogICAgIGNoYWkuQXNzZXJ0aW9uLmFkZENoYWluYWJsZU1ldGhvZCgnZm9vJywgZm4sIGNoYWluaW5nQmVoYXZpb3IpO1xuICpcbiAqIFRoZSByZXN1bHQgY2FuIHRoZW4gYmUgdXNlZCBhcyBib3RoIGEgbWV0aG9kIGFzc2VydGlvbiwgZXhlY3V0aW5nIGJvdGggYG1ldGhvZGAgYW5kXG4gKiBgY2hhaW5pbmdCZWhhdmlvcmAsIG9yIGFzIGEgbGFuZ3VhZ2UgY2hhaW4sIHdoaWNoIG9ubHkgZXhlY3V0ZXMgYGNoYWluaW5nQmVoYXZpb3JgLlxuICpcbiAqICAgICBleHBlY3QoZm9vU3RyKS50by5iZS5mb28oJ2JhcicpO1xuICogICAgIGV4cGVjdChmb29TdHIpLnRvLmJlLmZvby5lcXVhbCgnZm9vJyk7XG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGN0eCBvYmplY3QgdG8gd2hpY2ggdGhlIG1ldGhvZCBpcyBhZGRlZFxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgbWV0aG9kIHRvIGFkZFxuICogQHBhcmFtIHtGdW5jdGlvbn0gbWV0aG9kIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIGBuYW1lYCwgd2hlbiBjYWxsZWRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNoYWluaW5nQmVoYXZpb3IgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIGV2ZXJ5IHRpbWUgdGhlIHByb3BlcnR5IGlzIGFjY2Vzc2VkXG4gKiBAbmFtZSBhZGRDaGFpbmFibGVNZXRob2RcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBtZXRob2QsIGNoYWluaW5nQmVoYXZpb3IpIHtcbiAgaWYgKHR5cGVvZiBjaGFpbmluZ0JlaGF2aW9yICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgY2hhaW5pbmdCZWhhdmlvciA9IGZ1bmN0aW9uICgpIHsgfTtcbiAgfVxuXG4gIHZhciBjaGFpbmFibGVCZWhhdmlvciA9IHtcbiAgICAgIG1ldGhvZDogbWV0aG9kXG4gICAgLCBjaGFpbmluZ0JlaGF2aW9yOiBjaGFpbmluZ0JlaGF2aW9yXG4gIH07XG5cbiAgLy8gc2F2ZSB0aGUgbWV0aG9kcyBzbyB3ZSBjYW4gb3ZlcndyaXRlIHRoZW0gbGF0ZXIsIGlmIHdlIG5lZWQgdG8uXG4gIGlmICghY3R4Ll9fbWV0aG9kcykge1xuICAgIGN0eC5fX21ldGhvZHMgPSB7fTtcbiAgfVxuICBjdHguX19tZXRob2RzW25hbWVdID0gY2hhaW5hYmxlQmVoYXZpb3I7XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGN0eCwgbmFtZSxcbiAgICB7IGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICBjaGFpbmFibGVCZWhhdmlvci5jaGFpbmluZ0JlaGF2aW9yLmNhbGwodGhpcyk7XG5cbiAgICAgICAgdmFyIGFzc2VydCA9IGZ1bmN0aW9uIGFzc2VydCgpIHtcbiAgICAgICAgICB2YXIgb2xkX3NzZmkgPSBmbGFnKHRoaXMsICdzc2ZpJyk7XG4gICAgICAgICAgaWYgKG9sZF9zc2ZpICYmIGNvbmZpZy5pbmNsdWRlU3RhY2sgPT09IGZhbHNlKVxuICAgICAgICAgICAgZmxhZyh0aGlzLCAnc3NmaScsIGFzc2VydCk7XG4gICAgICAgICAgdmFyIHJlc3VsdCA9IGNoYWluYWJsZUJlaGF2aW9yLm1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gVXNlIGBfX3Byb3RvX19gIGlmIGF2YWlsYWJsZVxuICAgICAgICBpZiAoaGFzUHJvdG9TdXBwb3J0KSB7XG4gICAgICAgICAgLy8gSW5oZXJpdCBhbGwgcHJvcGVydGllcyBmcm9tIHRoZSBvYmplY3QgYnkgcmVwbGFjaW5nIHRoZSBgRnVuY3Rpb25gIHByb3RvdHlwZVxuICAgICAgICAgIHZhciBwcm90b3R5cGUgPSBhc3NlcnQuX19wcm90b19fID0gT2JqZWN0LmNyZWF0ZSh0aGlzKTtcbiAgICAgICAgICAvLyBSZXN0b3JlIHRoZSBgY2FsbGAgYW5kIGBhcHBseWAgbWV0aG9kcyBmcm9tIGBGdW5jdGlvbmBcbiAgICAgICAgICBwcm90b3R5cGUuY2FsbCA9IGNhbGw7XG4gICAgICAgICAgcHJvdG90eXBlLmFwcGx5ID0gYXBwbHk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gT3RoZXJ3aXNlLCByZWRlZmluZSBhbGwgcHJvcGVydGllcyAoc2xvdyEpXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIHZhciBhc3NlcnRlck5hbWVzID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoY3R4KTtcbiAgICAgICAgICBhc3NlcnRlck5hbWVzLmZvckVhY2goZnVuY3Rpb24gKGFzc2VydGVyTmFtZSkge1xuICAgICAgICAgICAgaWYgKCFleGNsdWRlTmFtZXMudGVzdChhc3NlcnRlck5hbWUpKSB7XG4gICAgICAgICAgICAgIHZhciBwZCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoY3R4LCBhc3NlcnRlck5hbWUpO1xuICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoYXNzZXJ0LCBhc3NlcnRlck5hbWUsIHBkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyYW5zZmVyRmxhZ3ModGhpcywgYXNzZXJ0KTtcbiAgICAgICAgcmV0dXJuIGFzc2VydDtcbiAgICAgIH1cbiAgICAsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICB9KTtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBhZGRNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbnZhciBjb25maWcgPSByZXF1aXJlKCcuLi9jb25maWcnKTtcblxuLyoqXG4gKiAjIyMgLmFkZE1ldGhvZCAoY3R4LCBuYW1lLCBtZXRob2QpXG4gKlxuICogQWRkcyBhIG1ldGhvZCB0byB0aGUgcHJvdG90eXBlIG9mIGFuIG9iamVjdC5cbiAqXG4gKiAgICAgdXRpbHMuYWRkTWV0aG9kKGNoYWkuQXNzZXJ0aW9uLnByb3RvdHlwZSwgJ2ZvbycsIGZ1bmN0aW9uIChzdHIpIHtcbiAqICAgICAgIHZhciBvYmogPSB1dGlscy5mbGFnKHRoaXMsICdvYmplY3QnKTtcbiAqICAgICAgIG5ldyBjaGFpLkFzc2VydGlvbihvYmopLnRvLmJlLmVxdWFsKHN0cik7XG4gKiAgICAgfSk7XG4gKlxuICogQ2FuIGFsc28gYmUgYWNjZXNzZWQgZGlyZWN0bHkgZnJvbSBgY2hhaS5Bc3NlcnRpb25gLlxuICpcbiAqICAgICBjaGFpLkFzc2VydGlvbi5hZGRNZXRob2QoJ2ZvbycsIGZuKTtcbiAqXG4gKiBUaGVuIGNhbiBiZSB1c2VkIGFzIGFueSBvdGhlciBhc3NlcnRpb24uXG4gKlxuICogICAgIGV4cGVjdChmb29TdHIpLnRvLmJlLmZvbygnYmFyJyk7XG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGN0eCBvYmplY3QgdG8gd2hpY2ggdGhlIG1ldGhvZCBpcyBhZGRlZFxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgbWV0aG9kIHRvIGFkZFxuICogQHBhcmFtIHtGdW5jdGlvbn0gbWV0aG9kIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIG5hbWVcbiAqIEBuYW1lIGFkZE1ldGhvZFxuICogQGFwaSBwdWJsaWNcbiAqL1xudmFyIGZsYWcgPSByZXF1aXJlKCcuL2ZsYWcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBtZXRob2QpIHtcbiAgY3R4W25hbWVdID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBvbGRfc3NmaSA9IGZsYWcodGhpcywgJ3NzZmknKTtcbiAgICBpZiAob2xkX3NzZmkgJiYgY29uZmlnLmluY2x1ZGVTdGFjayA9PT0gZmFsc2UpXG4gICAgICBmbGFnKHRoaXMsICdzc2ZpJywgY3R4W25hbWVdKTtcbiAgICB2YXIgcmVzdWx0ID0gbWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gdW5kZWZpbmVkID8gdGhpcyA6IHJlc3VsdDtcbiAgfTtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBhZGRQcm9wZXJ0eSB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIyMgYWRkUHJvcGVydHkgKGN0eCwgbmFtZSwgZ2V0dGVyKVxuICpcbiAqIEFkZHMgYSBwcm9wZXJ0eSB0byB0aGUgcHJvdG90eXBlIG9mIGFuIG9iamVjdC5cbiAqXG4gKiAgICAgdXRpbHMuYWRkUHJvcGVydHkoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnZm9vJywgZnVuY3Rpb24gKCkge1xuICogICAgICAgdmFyIG9iaiA9IHV0aWxzLmZsYWcodGhpcywgJ29iamVjdCcpO1xuICogICAgICAgbmV3IGNoYWkuQXNzZXJ0aW9uKG9iaikudG8uYmUuaW5zdGFuY2VvZihGb28pO1xuICogICAgIH0pO1xuICpcbiAqIENhbiBhbHNvIGJlIGFjY2Vzc2VkIGRpcmVjdGx5IGZyb20gYGNoYWkuQXNzZXJ0aW9uYC5cbiAqXG4gKiAgICAgY2hhaS5Bc3NlcnRpb24uYWRkUHJvcGVydHkoJ2ZvbycsIGZuKTtcbiAqXG4gKiBUaGVuIGNhbiBiZSB1c2VkIGFzIGFueSBvdGhlciBhc3NlcnRpb24uXG4gKlxuICogICAgIGV4cGVjdChteUZvbykudG8uYmUuZm9vO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHRvIHdoaWNoIHRoZSBwcm9wZXJ0eSBpcyBhZGRlZFxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgcHJvcGVydHkgdG8gYWRkXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBnZXR0ZXIgZnVuY3Rpb24gdG8gYmUgdXNlZCBmb3IgbmFtZVxuICogQG5hbWUgYWRkUHJvcGVydHlcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBnZXR0ZXIpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGN0eCwgbmFtZSxcbiAgICB7IGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcmVzdWx0ID0gZ2V0dGVyLmNhbGwodGhpcyk7XG4gICAgICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gICAgICB9XG4gICAgLCBjb25maWd1cmFibGU6IHRydWVcbiAgfSk7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZmxhZyB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIyMgZmxhZyhvYmplY3QsIGtleSwgW3ZhbHVlXSlcbiAqXG4gKiBHZXQgb3Igc2V0IGEgZmxhZyB2YWx1ZSBvbiBhbiBvYmplY3QuIElmIGFcbiAqIHZhbHVlIGlzIHByb3ZpZGVkIGl0IHdpbGwgYmUgc2V0LCBlbHNlIGl0IHdpbGxcbiAqIHJldHVybiB0aGUgY3VycmVudGx5IHNldCB2YWx1ZSBvciBgdW5kZWZpbmVkYCBpZlxuICogdGhlIHZhbHVlIGlzIG5vdCBzZXQuXG4gKlxuICogICAgIHV0aWxzLmZsYWcodGhpcywgJ2ZvbycsICdiYXInKTsgLy8gc2V0dGVyXG4gKiAgICAgdXRpbHMuZmxhZyh0aGlzLCAnZm9vJyk7IC8vIGdldHRlciwgcmV0dXJucyBgYmFyYFxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgY29uc3RydWN0ZWQgQXNzZXJ0aW9uXG4gKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gKiBAcGFyYW0ge01peGVkfSB2YWx1ZSAob3B0aW9uYWwpXG4gKiBAbmFtZSBmbGFnXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmosIGtleSwgdmFsdWUpIHtcbiAgdmFyIGZsYWdzID0gb2JqLl9fZmxhZ3MgfHwgKG9iai5fX2ZsYWdzID0gT2JqZWN0LmNyZWF0ZShudWxsKSk7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAzKSB7XG4gICAgZmxhZ3Nba2V5XSA9IHZhbHVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBmbGFnc1trZXldO1xuICB9XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZ2V0QWN0dWFsIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBNSVQgTGljZW5zZWRcbiAqL1xuXG4vKipcbiAqICMgZ2V0QWN0dWFsKG9iamVjdCwgW2FjdHVhbF0pXG4gKlxuICogUmV0dXJucyB0aGUgYGFjdHVhbGAgdmFsdWUgZm9yIGFuIEFzc2VydGlvblxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgKGNvbnN0cnVjdGVkIEFzc2VydGlvbilcbiAqIEBwYXJhbSB7QXJndW1lbnRzfSBjaGFpLkFzc2VydGlvbi5wcm90b3R5cGUuYXNzZXJ0IGFyZ3VtZW50c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaiwgYXJncykge1xuICByZXR1cm4gYXJncy5sZW5ndGggPiA0ID8gYXJnc1s0XSA6IG9iai5fb2JqO1xufTtcbiIsIi8qIVxuICogQ2hhaSAtIGdldEVudW1lcmFibGVQcm9wZXJ0aWVzIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBNSVQgTGljZW5zZWRcbiAqL1xuXG4vKipcbiAqICMjIyAuZ2V0RW51bWVyYWJsZVByb3BlcnRpZXMob2JqZWN0KVxuICpcbiAqIFRoaXMgYWxsb3dzIHRoZSByZXRyaWV2YWwgb2YgZW51bWVyYWJsZSBwcm9wZXJ0eSBuYW1lcyBvZiBhbiBvYmplY3QsXG4gKiBpbmhlcml0ZWQgb3Igbm90LlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAqIEByZXR1cm5zIHtBcnJheX1cbiAqIEBuYW1lIGdldEVudW1lcmFibGVQcm9wZXJ0aWVzXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZ2V0RW51bWVyYWJsZVByb3BlcnRpZXMob2JqZWN0KSB7XG4gIHZhciByZXN1bHQgPSBbXTtcbiAgZm9yICh2YXIgbmFtZSBpbiBvYmplY3QpIHtcbiAgICByZXN1bHQucHVzaChuYW1lKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufTtcbiIsIi8qIVxuICogQ2hhaSAtIG1lc3NhZ2UgY29tcG9zaXRpb24gdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogTW9kdWxlIGRlcGVuZGFuY2llc1xuICovXG5cbnZhciBmbGFnID0gcmVxdWlyZSgnLi9mbGFnJylcbiAgLCBnZXRBY3R1YWwgPSByZXF1aXJlKCcuL2dldEFjdHVhbCcpXG4gICwgaW5zcGVjdCA9IHJlcXVpcmUoJy4vaW5zcGVjdCcpXG4gICwgb2JqRGlzcGxheSA9IHJlcXVpcmUoJy4vb2JqRGlzcGxheScpO1xuXG4vKipcbiAqICMjIyAuZ2V0TWVzc2FnZShvYmplY3QsIG1lc3NhZ2UsIG5lZ2F0ZU1lc3NhZ2UpXG4gKlxuICogQ29uc3RydWN0IHRoZSBlcnJvciBtZXNzYWdlIGJhc2VkIG9uIGZsYWdzXG4gKiBhbmQgdGVtcGxhdGUgdGFncy4gVGVtcGxhdGUgdGFncyB3aWxsIHJldHVyblxuICogYSBzdHJpbmdpZmllZCBpbnNwZWN0aW9uIG9mIHRoZSBvYmplY3QgcmVmZXJlbmNlZC5cbiAqXG4gKiBNZXNzYWdlIHRlbXBsYXRlIHRhZ3M6XG4gKiAtIGAje3RoaXN9YCBjdXJyZW50IGFzc2VydGVkIG9iamVjdFxuICogLSBgI3thY3R9YCBhY3R1YWwgdmFsdWVcbiAqIC0gYCN7ZXhwfWAgZXhwZWN0ZWQgdmFsdWVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IChjb25zdHJ1Y3RlZCBBc3NlcnRpb24pXG4gKiBAcGFyYW0ge0FyZ3VtZW50c30gY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLmFzc2VydCBhcmd1bWVudHNcbiAqIEBuYW1lIGdldE1lc3NhZ2VcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqLCBhcmdzKSB7XG4gIHZhciBuZWdhdGUgPSBmbGFnKG9iaiwgJ25lZ2F0ZScpXG4gICAgLCB2YWwgPSBmbGFnKG9iaiwgJ29iamVjdCcpXG4gICAgLCBleHBlY3RlZCA9IGFyZ3NbM11cbiAgICAsIGFjdHVhbCA9IGdldEFjdHVhbChvYmosIGFyZ3MpXG4gICAgLCBtc2cgPSBuZWdhdGUgPyBhcmdzWzJdIDogYXJnc1sxXVxuICAgICwgZmxhZ01zZyA9IGZsYWcob2JqLCAnbWVzc2FnZScpO1xuXG4gIGlmKHR5cGVvZiBtc2cgPT09IFwiZnVuY3Rpb25cIikgbXNnID0gbXNnKCk7XG4gIG1zZyA9IG1zZyB8fCAnJztcbiAgbXNnID0gbXNnXG4gICAgLnJlcGxhY2UoLyN7dGhpc30vZywgb2JqRGlzcGxheSh2YWwpKVxuICAgIC5yZXBsYWNlKC8je2FjdH0vZywgb2JqRGlzcGxheShhY3R1YWwpKVxuICAgIC5yZXBsYWNlKC8je2V4cH0vZywgb2JqRGlzcGxheShleHBlY3RlZCkpO1xuXG4gIHJldHVybiBmbGFnTXNnID8gZmxhZ01zZyArICc6ICcgKyBtc2cgOiBtc2c7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZ2V0TmFtZSB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIGdldE5hbWUoZnVuYylcbiAqXG4gKiBHZXRzIHRoZSBuYW1lIG9mIGEgZnVuY3Rpb24sIGluIGEgY3Jvc3MtYnJvd3NlciB3YXkuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gYSBmdW5jdGlvbiAodXN1YWxseSBhIGNvbnN0cnVjdG9yKVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGZ1bmMpIHtcbiAgaWYgKGZ1bmMubmFtZSkgcmV0dXJuIGZ1bmMubmFtZTtcblxuICB2YXIgbWF0Y2ggPSAvXlxccz9mdW5jdGlvbiAoW14oXSopXFwoLy5leGVjKGZ1bmMpO1xuICByZXR1cm4gbWF0Y2ggJiYgbWF0Y2hbMV0gPyBtYXRjaFsxXSA6IFwiXCI7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZ2V0UGF0aEluZm8gdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbnZhciBoYXNQcm9wZXJ0eSA9IHJlcXVpcmUoJy4vaGFzUHJvcGVydHknKTtcblxuLyoqXG4gKiAjIyMgLmdldFBhdGhJbmZvKHBhdGgsIG9iamVjdClcbiAqXG4gKiBUaGlzIGFsbG93cyB0aGUgcmV0cmlldmFsIG9mIHByb3BlcnR5IGluZm8gaW4gYW5cbiAqIG9iamVjdCBnaXZlbiBhIHN0cmluZyBwYXRoLlxuICpcbiAqIFRoZSBwYXRoIGluZm8gY29uc2lzdHMgb2YgYW4gb2JqZWN0IHdpdGggdGhlXG4gKiBmb2xsb3dpbmcgcHJvcGVydGllczpcbiAqXG4gKiAqIHBhcmVudCAtIFRoZSBwYXJlbnQgb2JqZWN0IG9mIHRoZSBwcm9wZXJ0eSByZWZlcmVuY2VkIGJ5IGBwYXRoYFxuICogKiBuYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGZpbmFsIHByb3BlcnR5LCBhIG51bWJlciBpZiBpdCB3YXMgYW4gYXJyYXkgaW5kZXhlclxuICogKiB2YWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgcHJvcGVydHksIGlmIGl0IGV4aXN0cywgb3RoZXJ3aXNlIGB1bmRlZmluZWRgXG4gKiAqIGV4aXN0cyAtIFdoZXRoZXIgdGhlIHByb3BlcnR5IGV4aXN0cyBvciBub3RcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICogQHJldHVybnMge09iamVjdH0gaW5mb1xuICogQG5hbWUgZ2V0UGF0aEluZm9cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBnZXRQYXRoSW5mbyhwYXRoLCBvYmopIHtcbiAgdmFyIHBhcnNlZCA9IHBhcnNlUGF0aChwYXRoKSxcbiAgICAgIGxhc3QgPSBwYXJzZWRbcGFyc2VkLmxlbmd0aCAtIDFdO1xuXG4gIHZhciBpbmZvID0ge1xuICAgIHBhcmVudDogcGFyc2VkLmxlbmd0aCA+IDEgPyBfZ2V0UGF0aFZhbHVlKHBhcnNlZCwgb2JqLCBwYXJzZWQubGVuZ3RoIC0gMSkgOiBvYmosXG4gICAgbmFtZTogbGFzdC5wIHx8IGxhc3QuaSxcbiAgICB2YWx1ZTogX2dldFBhdGhWYWx1ZShwYXJzZWQsIG9iaiksXG4gIH07XG4gIGluZm8uZXhpc3RzID0gaGFzUHJvcGVydHkoaW5mby5uYW1lLCBpbmZvLnBhcmVudCk7XG5cbiAgcmV0dXJuIGluZm87XG59O1xuXG5cbi8qIVxuICogIyMgcGFyc2VQYXRoKHBhdGgpXG4gKlxuICogSGVscGVyIGZ1bmN0aW9uIHVzZWQgdG8gcGFyc2Ugc3RyaW5nIG9iamVjdFxuICogcGF0aHMuIFVzZSBpbiBjb25qdW5jdGlvbiB3aXRoIGBfZ2V0UGF0aFZhbHVlYC5cbiAqXG4gKiAgICAgIHZhciBwYXJzZWQgPSBwYXJzZVBhdGgoJ215b2JqZWN0LnByb3BlcnR5LnN1YnByb3AnKTtcbiAqXG4gKiAjIyMgUGF0aHM6XG4gKlxuICogKiBDYW4gYmUgYXMgbmVhciBpbmZpbml0ZWx5IGRlZXAgYW5kIG5lc3RlZFxuICogKiBBcnJheXMgYXJlIGFsc28gdmFsaWQgdXNpbmcgdGhlIGZvcm1hbCBgbXlvYmplY3QuZG9jdW1lbnRbM10ucHJvcGVydHlgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBwYXJzZWRcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHBhcnNlUGF0aCAocGF0aCkge1xuICB2YXIgc3RyID0gcGF0aC5yZXBsYWNlKC9cXFsvZywgJy5bJylcbiAgICAsIHBhcnRzID0gc3RyLm1hdGNoKC8oXFxcXFxcLnxbXi5dKz8pKy9nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcChmdW5jdGlvbiAodmFsdWUpIHtcbiAgICB2YXIgcmUgPSAvXFxbKFxcZCspXFxdJC9cbiAgICAgICwgbUFyciA9IHJlLmV4ZWModmFsdWUpO1xuICAgIGlmIChtQXJyKSByZXR1cm4geyBpOiBwYXJzZUZsb2F0KG1BcnJbMV0pIH07XG4gICAgZWxzZSByZXR1cm4geyBwOiB2YWx1ZSB9O1xuICB9KTtcbn1cblxuXG4vKiFcbiAqICMjIF9nZXRQYXRoVmFsdWUocGFyc2VkLCBvYmopXG4gKlxuICogSGVscGVyIGNvbXBhbmlvbiBmdW5jdGlvbiBmb3IgYC5wYXJzZVBhdGhgIHRoYXQgcmV0dXJuc1xuICogdGhlIHZhbHVlIGxvY2F0ZWQgYXQgdGhlIHBhcnNlZCBhZGRyZXNzLlxuICpcbiAqICAgICAgdmFyIHZhbHVlID0gZ2V0UGF0aFZhbHVlKHBhcnNlZCwgb2JqKTtcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFyc2VkIGRlZmluaXRpb24gZnJvbSBgcGFyc2VQYXRoYC5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgdG8gc2VhcmNoIGFnYWluc3RcbiAqIEBwYXJhbSB7TnVtYmVyfSBvYmplY3QgdG8gc2VhcmNoIGFnYWluc3RcbiAqIEByZXR1cm5zIHtPYmplY3R8VW5kZWZpbmVkfSB2YWx1ZVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gX2dldFBhdGhWYWx1ZSAocGFyc2VkLCBvYmosIGluZGV4KSB7XG4gIHZhciB0bXAgPSBvYmpcbiAgICAsIHJlcztcblxuICBpbmRleCA9IChpbmRleCA9PT0gdW5kZWZpbmVkID8gcGFyc2VkLmxlbmd0aCA6IGluZGV4KTtcblxuICBmb3IgKHZhciBpID0gMCwgbCA9IGluZGV4OyBpIDwgbDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJzZWRbaV07XG4gICAgaWYgKHRtcCkge1xuICAgICAgaWYgKCd1bmRlZmluZWQnICE9PSB0eXBlb2YgcGFydC5wKVxuICAgICAgICB0bXAgPSB0bXBbcGFydC5wXTtcbiAgICAgIGVsc2UgaWYgKCd1bmRlZmluZWQnICE9PSB0eXBlb2YgcGFydC5pKVxuICAgICAgICB0bXAgPSB0bXBbcGFydC5pXTtcbiAgICAgIGlmIChpID09IChsIC0gMSkpIHJlcyA9IHRtcDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzO1xufVxuIiwiLyohXG4gKiBDaGFpIC0gZ2V0UGF0aFZhbHVlIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9sb2dpY2FscGFyYWRveC9maWx0clxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxudmFyIGdldFBhdGhJbmZvID0gcmVxdWlyZSgnLi9nZXRQYXRoSW5mbycpO1xuXG4vKipcbiAqICMjIyAuZ2V0UGF0aFZhbHVlKHBhdGgsIG9iamVjdClcbiAqXG4gKiBUaGlzIGFsbG93cyB0aGUgcmV0cmlldmFsIG9mIHZhbHVlcyBpbiBhblxuICogb2JqZWN0IGdpdmVuIGEgc3RyaW5nIHBhdGguXG4gKlxuICogICAgIHZhciBvYmogPSB7XG4gKiAgICAgICAgIHByb3AxOiB7XG4gKiAgICAgICAgICAgICBhcnI6IFsnYScsICdiJywgJ2MnXVxuICogICAgICAgICAgICwgc3RyOiAnSGVsbG8nXG4gKiAgICAgICAgIH1cbiAqICAgICAgICwgcHJvcDI6IHtcbiAqICAgICAgICAgICAgIGFycjogWyB7IG5lc3RlZDogJ1VuaXZlcnNlJyB9IF1cbiAqICAgICAgICAgICAsIHN0cjogJ0hlbGxvIGFnYWluISdcbiAqICAgICAgICAgfVxuICogICAgIH1cbiAqXG4gKiBUaGUgZm9sbG93aW5nIHdvdWxkIGJlIHRoZSByZXN1bHRzLlxuICpcbiAqICAgICBnZXRQYXRoVmFsdWUoJ3Byb3AxLnN0cicsIG9iaik7IC8vIEhlbGxvXG4gKiAgICAgZ2V0UGF0aFZhbHVlKCdwcm9wMS5hdHRbMl0nLCBvYmopOyAvLyBiXG4gKiAgICAgZ2V0UGF0aFZhbHVlKCdwcm9wMi5hcnJbMF0ubmVzdGVkJywgb2JqKTsgLy8gVW5pdmVyc2VcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICogQHJldHVybnMge09iamVjdH0gdmFsdWUgb3IgYHVuZGVmaW5lZGBcbiAqIEBuYW1lIGdldFBhdGhWYWx1ZVxuICogQGFwaSBwdWJsaWNcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihwYXRoLCBvYmopIHtcbiAgdmFyIGluZm8gPSBnZXRQYXRoSW5mbyhwYXRoLCBvYmopO1xuICByZXR1cm4gaW5mby52YWx1ZTtcbn07IFxuIiwiLyohXG4gKiBDaGFpIC0gZ2V0UHJvcGVydGllcyB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIyMgLmdldFByb3BlcnRpZXMob2JqZWN0KVxuICpcbiAqIFRoaXMgYWxsb3dzIHRoZSByZXRyaWV2YWwgb2YgcHJvcGVydHkgbmFtZXMgb2YgYW4gb2JqZWN0LCBlbnVtZXJhYmxlIG9yIG5vdCxcbiAqIGluaGVyaXRlZCBvciBub3QuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICogQHJldHVybnMge0FycmF5fVxuICogQG5hbWUgZ2V0UHJvcGVydGllc1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGdldFByb3BlcnRpZXMob2JqZWN0KSB7XG4gIHZhciByZXN1bHQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzdWJqZWN0KTtcblxuICBmdW5jdGlvbiBhZGRQcm9wZXJ0eShwcm9wZXJ0eSkge1xuICAgIGlmIChyZXN1bHQuaW5kZXhPZihwcm9wZXJ0eSkgPT09IC0xKSB7XG4gICAgICByZXN1bHQucHVzaChwcm9wZXJ0eSk7XG4gICAgfVxuICB9XG5cbiAgdmFyIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHN1YmplY3QpO1xuICB3aGlsZSAocHJvdG8gIT09IG51bGwpIHtcbiAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhwcm90bykuZm9yRWFjaChhZGRQcm9wZXJ0eSk7XG4gICAgcHJvdG8gPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG8pO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBoYXNQcm9wZXJ0eSB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxudmFyIHR5cGUgPSByZXF1aXJlKCcuL3R5cGUnKTtcblxuLyoqXG4gKiAjIyMgLmhhc1Byb3BlcnR5KG9iamVjdCwgbmFtZSlcbiAqXG4gKiBUaGlzIGFsbG93cyBjaGVja2luZyB3aGV0aGVyIGFuIG9iamVjdCBoYXNcbiAqIG5hbWVkIHByb3BlcnR5IG9yIG51bWVyaWMgYXJyYXkgaW5kZXguXG4gKlxuICogQmFzaWNhbGx5IGRvZXMgdGhlIHNhbWUgdGhpbmcgYXMgdGhlIGBpbmBcbiAqIG9wZXJhdG9yIGJ1dCB3b3JrcyBwcm9wZXJseSB3aXRoIG5hdGl2ZXNcbiAqIGFuZCBudWxsL3VuZGVmaW5lZCB2YWx1ZXMuXG4gKlxuICogICAgIHZhciBvYmogPSB7XG4gKiAgICAgICAgIGFycjogWydhJywgJ2InLCAnYyddXG4gKiAgICAgICAsIHN0cjogJ0hlbGxvJ1xuICogICAgIH1cbiAqXG4gKiBUaGUgZm9sbG93aW5nIHdvdWxkIGJlIHRoZSByZXN1bHRzLlxuICpcbiAqICAgICBoYXNQcm9wZXJ0eSgnc3RyJywgb2JqKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgnY29uc3RydWN0b3InLCBvYmopOyAgLy8gdHJ1ZVxuICogICAgIGhhc1Byb3BlcnR5KCdiYXInLCBvYmopOyAgLy8gZmFsc2VcbiAqICAgICBcbiAqICAgICBoYXNQcm9wZXJ0eSgnbGVuZ3RoJywgb2JqLnN0cik7IC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgxLCBvYmouc3RyKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSg1LCBvYmouc3RyKTsgIC8vIGZhbHNlXG4gKlxuICogICAgIGhhc1Byb3BlcnR5KCdsZW5ndGgnLCBvYmouYXJyKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgyLCBvYmouYXJyKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgzLCBvYmouYXJyKTsgIC8vIGZhbHNlXG4gKlxuICogQHBhcmFtIHtPYmp1ZWN0fSBvYmplY3RcbiAqIEBwYXJhbSB7U3RyaW5nfE51bWJlcn0gbmFtZVxuICogQHJldHVybnMge0Jvb2xlYW59IHdoZXRoZXIgaXQgZXhpc3RzXG4gKiBAbmFtZSBnZXRQYXRoSW5mb1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG52YXIgbGl0ZXJhbHMgPSB7XG4gICAgJ251bWJlcic6IE51bWJlclxuICAsICdzdHJpbmcnOiBTdHJpbmdcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaGFzUHJvcGVydHkobmFtZSwgb2JqKSB7XG4gIHZhciBvdCA9IHR5cGUob2JqKTtcblxuICAvLyBCYWQgT2JqZWN0LCBvYnZpb3VzbHkgbm8gcHJvcHMgYXQgYWxsXG4gIGlmKG90ID09PSAnbnVsbCcgfHwgb3QgPT09ICd1bmRlZmluZWQnKVxuICAgIHJldHVybiBmYWxzZTtcblxuICAvLyBUaGUgYGluYCBvcGVyYXRvciBkb2VzIG5vdCB3b3JrIHdpdGggY2VydGFpbiBsaXRlcmFsc1xuICAvLyBib3ggdGhlc2UgYmVmb3JlIHRoZSBjaGVja1xuICBpZihsaXRlcmFsc1tvdF0gJiYgdHlwZW9mIG9iaiAhPT0gJ29iamVjdCcpXG4gICAgb2JqID0gbmV3IGxpdGVyYWxzW290XShvYmopO1xuXG4gIHJldHVybiBuYW1lIGluIG9iajtcbn07XG4iLCIvKiFcbiAqIGNoYWlcbiAqIENvcHlyaWdodChjKSAyMDExIEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBNYWluIGV4cG9ydHNcbiAqL1xuXG52YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbi8qIVxuICogdGVzdCB1dGlsaXR5XG4gKi9cblxuZXhwb3J0cy50ZXN0ID0gcmVxdWlyZSgnLi90ZXN0Jyk7XG5cbi8qIVxuICogdHlwZSB1dGlsaXR5XG4gKi9cblxuZXhwb3J0cy50eXBlID0gcmVxdWlyZSgnLi90eXBlJyk7XG5cbi8qIVxuICogbWVzc2FnZSB1dGlsaXR5XG4gKi9cblxuZXhwb3J0cy5nZXRNZXNzYWdlID0gcmVxdWlyZSgnLi9nZXRNZXNzYWdlJyk7XG5cbi8qIVxuICogYWN0dWFsIHV0aWxpdHlcbiAqL1xuXG5leHBvcnRzLmdldEFjdHVhbCA9IHJlcXVpcmUoJy4vZ2V0QWN0dWFsJyk7XG5cbi8qIVxuICogSW5zcGVjdCB1dGlsXG4gKi9cblxuZXhwb3J0cy5pbnNwZWN0ID0gcmVxdWlyZSgnLi9pbnNwZWN0Jyk7XG5cbi8qIVxuICogT2JqZWN0IERpc3BsYXkgdXRpbFxuICovXG5cbmV4cG9ydHMub2JqRGlzcGxheSA9IHJlcXVpcmUoJy4vb2JqRGlzcGxheScpO1xuXG4vKiFcbiAqIEZsYWcgdXRpbGl0eVxuICovXG5cbmV4cG9ydHMuZmxhZyA9IHJlcXVpcmUoJy4vZmxhZycpO1xuXG4vKiFcbiAqIEZsYWcgdHJhbnNmZXJyaW5nIHV0aWxpdHlcbiAqL1xuXG5leHBvcnRzLnRyYW5zZmVyRmxhZ3MgPSByZXF1aXJlKCcuL3RyYW5zZmVyRmxhZ3MnKTtcblxuLyohXG4gKiBEZWVwIGVxdWFsIHV0aWxpdHlcbiAqL1xuXG5leHBvcnRzLmVxbCA9IHJlcXVpcmUoJ2RlZXAtZXFsJyk7XG5cbi8qIVxuICogRGVlcCBwYXRoIHZhbHVlXG4gKi9cblxuZXhwb3J0cy5nZXRQYXRoVmFsdWUgPSByZXF1aXJlKCcuL2dldFBhdGhWYWx1ZScpO1xuXG4vKiFcbiAqIERlZXAgcGF0aCBpbmZvXG4gKi9cblxuZXhwb3J0cy5nZXRQYXRoSW5mbyA9IHJlcXVpcmUoJy4vZ2V0UGF0aEluZm8nKTtcblxuLyohXG4gKiBDaGVjayBpZiBhIHByb3BlcnR5IGV4aXN0c1xuICovXG5cbmV4cG9ydHMuaGFzUHJvcGVydHkgPSByZXF1aXJlKCcuL2hhc1Byb3BlcnR5Jyk7XG5cbi8qIVxuICogRnVuY3Rpb24gbmFtZVxuICovXG5cbmV4cG9ydHMuZ2V0TmFtZSA9IHJlcXVpcmUoJy4vZ2V0TmFtZScpO1xuXG4vKiFcbiAqIGFkZCBQcm9wZXJ0eVxuICovXG5cbmV4cG9ydHMuYWRkUHJvcGVydHkgPSByZXF1aXJlKCcuL2FkZFByb3BlcnR5Jyk7XG5cbi8qIVxuICogYWRkIE1ldGhvZFxuICovXG5cbmV4cG9ydHMuYWRkTWV0aG9kID0gcmVxdWlyZSgnLi9hZGRNZXRob2QnKTtcblxuLyohXG4gKiBvdmVyd3JpdGUgUHJvcGVydHlcbiAqL1xuXG5leHBvcnRzLm92ZXJ3cml0ZVByb3BlcnR5ID0gcmVxdWlyZSgnLi9vdmVyd3JpdGVQcm9wZXJ0eScpO1xuXG4vKiFcbiAqIG92ZXJ3cml0ZSBNZXRob2RcbiAqL1xuXG5leHBvcnRzLm92ZXJ3cml0ZU1ldGhvZCA9IHJlcXVpcmUoJy4vb3ZlcndyaXRlTWV0aG9kJyk7XG5cbi8qIVxuICogQWRkIGEgY2hhaW5hYmxlIG1ldGhvZFxuICovXG5cbmV4cG9ydHMuYWRkQ2hhaW5hYmxlTWV0aG9kID0gcmVxdWlyZSgnLi9hZGRDaGFpbmFibGVNZXRob2QnKTtcblxuLyohXG4gKiBPdmVyd3JpdGUgY2hhaW5hYmxlIG1ldGhvZFxuICovXG5cbmV4cG9ydHMub3ZlcndyaXRlQ2hhaW5hYmxlTWV0aG9kID0gcmVxdWlyZSgnLi9vdmVyd3JpdGVDaGFpbmFibGVNZXRob2QnKTtcblxuIiwiLy8gVGhpcyBpcyAoYWxtb3N0KSBkaXJlY3RseSBmcm9tIE5vZGUuanMgdXRpbHNcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9qb3llbnQvbm9kZS9ibG9iL2Y4YzMzNWQwY2FmNDdmMTZkMzE0MTNmODlhYTI4ZWRhMzg3OGUzYWEvbGliL3V0aWwuanNcblxudmFyIGdldE5hbWUgPSByZXF1aXJlKCcuL2dldE5hbWUnKTtcbnZhciBnZXRQcm9wZXJ0aWVzID0gcmVxdWlyZSgnLi9nZXRQcm9wZXJ0aWVzJyk7XG52YXIgZ2V0RW51bWVyYWJsZVByb3BlcnRpZXMgPSByZXF1aXJlKCcuL2dldEVudW1lcmFibGVQcm9wZXJ0aWVzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gaW5zcGVjdDtcblxuLyoqXG4gKiBFY2hvcyB0aGUgdmFsdWUgb2YgYSB2YWx1ZS4gVHJ5cyB0byBwcmludCB0aGUgdmFsdWUgb3V0XG4gKiBpbiB0aGUgYmVzdCB3YXkgcG9zc2libGUgZ2l2ZW4gdGhlIGRpZmZlcmVudCB0eXBlcy5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqIFRoZSBvYmplY3QgdG8gcHJpbnQgb3V0LlxuICogQHBhcmFtIHtCb29sZWFufSBzaG93SGlkZGVuIEZsYWcgdGhhdCBzaG93cyBoaWRkZW4gKG5vdCBlbnVtZXJhYmxlKVxuICogICAgcHJvcGVydGllcyBvZiBvYmplY3RzLlxuICogQHBhcmFtIHtOdW1iZXJ9IGRlcHRoIERlcHRoIGluIHdoaWNoIHRvIGRlc2NlbmQgaW4gb2JqZWN0LiBEZWZhdWx0IGlzIDIuXG4gKiBAcGFyYW0ge0Jvb2xlYW59IGNvbG9ycyBGbGFnIHRvIHR1cm4gb24gQU5TSSBlc2NhcGUgY29kZXMgdG8gY29sb3IgdGhlXG4gKiAgICBvdXRwdXQuIERlZmF1bHQgaXMgZmFsc2UgKG5vIGNvbG9yaW5nKS5cbiAqL1xuZnVuY3Rpb24gaW5zcGVjdChvYmosIHNob3dIaWRkZW4sIGRlcHRoLCBjb2xvcnMpIHtcbiAgdmFyIGN0eCA9IHtcbiAgICBzaG93SGlkZGVuOiBzaG93SGlkZGVuLFxuICAgIHNlZW46IFtdLFxuICAgIHN0eWxpemU6IGZ1bmN0aW9uIChzdHIpIHsgcmV0dXJuIHN0cjsgfVxuICB9O1xuICByZXR1cm4gZm9ybWF0VmFsdWUoY3R4LCBvYmosICh0eXBlb2YgZGVwdGggPT09ICd1bmRlZmluZWQnID8gMiA6IGRlcHRoKSk7XG59XG5cbi8vIFJldHVybnMgdHJ1ZSBpZiBvYmplY3QgaXMgYSBET00gZWxlbWVudC5cbnZhciBpc0RPTUVsZW1lbnQgPSBmdW5jdGlvbiAob2JqZWN0KSB7XG4gIGlmICh0eXBlb2YgSFRNTEVsZW1lbnQgPT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG9iamVjdCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50O1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBvYmplY3QgJiZcbiAgICAgIHR5cGVvZiBvYmplY3QgPT09ICdvYmplY3QnICYmXG4gICAgICBvYmplY3Qubm9kZVR5cGUgPT09IDEgJiZcbiAgICAgIHR5cGVvZiBvYmplY3Qubm9kZU5hbWUgPT09ICdzdHJpbmcnO1xuICB9XG59O1xuXG5mdW5jdGlvbiBmb3JtYXRWYWx1ZShjdHgsIHZhbHVlLCByZWN1cnNlVGltZXMpIHtcbiAgLy8gUHJvdmlkZSBhIGhvb2sgZm9yIHVzZXItc3BlY2lmaWVkIGluc3BlY3QgZnVuY3Rpb25zLlxuICAvLyBDaGVjayB0aGF0IHZhbHVlIGlzIGFuIG9iamVjdCB3aXRoIGFuIGluc3BlY3QgZnVuY3Rpb24gb24gaXRcbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5pbnNwZWN0ID09PSAnZnVuY3Rpb24nICYmXG4gICAgICAvLyBGaWx0ZXIgb3V0IHRoZSB1dGlsIG1vZHVsZSwgaXQncyBpbnNwZWN0IGZ1bmN0aW9uIGlzIHNwZWNpYWxcbiAgICAgIHZhbHVlLmluc3BlY3QgIT09IGV4cG9ydHMuaW5zcGVjdCAmJlxuICAgICAgLy8gQWxzbyBmaWx0ZXIgb3V0IGFueSBwcm90b3R5cGUgb2JqZWN0cyB1c2luZyB0aGUgY2lyY3VsYXIgY2hlY2suXG4gICAgICAhKHZhbHVlLmNvbnN0cnVjdG9yICYmIHZhbHVlLmNvbnN0cnVjdG9yLnByb3RvdHlwZSA9PT0gdmFsdWUpKSB7XG4gICAgdmFyIHJldCA9IHZhbHVlLmluc3BlY3QocmVjdXJzZVRpbWVzKTtcbiAgICBpZiAodHlwZW9mIHJldCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldCA9IGZvcm1hdFZhbHVlKGN0eCwgcmV0LCByZWN1cnNlVGltZXMpO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xuICB9XG5cbiAgLy8gUHJpbWl0aXZlIHR5cGVzIGNhbm5vdCBoYXZlIHByb3BlcnRpZXNcbiAgdmFyIHByaW1pdGl2ZSA9IGZvcm1hdFByaW1pdGl2ZShjdHgsIHZhbHVlKTtcbiAgaWYgKHByaW1pdGl2ZSkge1xuICAgIHJldHVybiBwcmltaXRpdmU7XG4gIH1cblxuICAvLyBJZiB0aGlzIGlzIGEgRE9NIGVsZW1lbnQsIHRyeSB0byBnZXQgdGhlIG91dGVyIEhUTUwuXG4gIGlmIChpc0RPTUVsZW1lbnQodmFsdWUpKSB7XG4gICAgaWYgKCdvdXRlckhUTUwnIGluIHZhbHVlKSB7XG4gICAgICByZXR1cm4gdmFsdWUub3V0ZXJIVE1MO1xuICAgICAgLy8gVGhpcyB2YWx1ZSBkb2VzIG5vdCBoYXZlIGFuIG91dGVySFRNTCBhdHRyaWJ1dGUsXG4gICAgICAvLyAgIGl0IGNvdWxkIHN0aWxsIGJlIGFuIFhNTCBlbGVtZW50XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEF0dGVtcHQgdG8gc2VyaWFsaXplIGl0XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoZG9jdW1lbnQueG1sVmVyc2lvbikge1xuICAgICAgICAgIHZhciB4bWxTZXJpYWxpemVyID0gbmV3IFhNTFNlcmlhbGl6ZXIoKTtcbiAgICAgICAgICByZXR1cm4geG1sU2VyaWFsaXplci5zZXJpYWxpemVUb1N0cmluZyh2YWx1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRmlyZWZveCAxMS0gZG8gbm90IHN1cHBvcnQgb3V0ZXJIVE1MXG4gICAgICAgICAgLy8gICBJdCBkb2VzLCBob3dldmVyLCBzdXBwb3J0IGlubmVySFRNTFxuICAgICAgICAgIC8vICAgVXNlIHRoZSBmb2xsb3dpbmcgdG8gcmVuZGVyIHRoZSBlbGVtZW50XG4gICAgICAgICAgdmFyIG5zID0gXCJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hodG1sXCI7XG4gICAgICAgICAgdmFyIGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhucywgJ18nKTtcblxuICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZCh2YWx1ZS5jbG9uZU5vZGUoZmFsc2UpKTtcbiAgICAgICAgICBodG1sID0gY29udGFpbmVyLmlubmVySFRNTFxuICAgICAgICAgICAgLnJlcGxhY2UoJz48JywgJz4nICsgdmFsdWUuaW5uZXJIVE1MICsgJzwnKTtcbiAgICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gJyc7XG4gICAgICAgICAgcmV0dXJuIGh0bWw7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAvLyBUaGlzIGNvdWxkIGJlIGEgbm9uLW5hdGl2ZSBET00gaW1wbGVtZW50YXRpb24sXG4gICAgICAgIC8vICAgY29udGludWUgd2l0aCB0aGUgbm9ybWFsIGZsb3c6XG4gICAgICAgIC8vICAgcHJpbnRpbmcgdGhlIGVsZW1lbnQgYXMgaWYgaXQgaXMgYW4gb2JqZWN0LlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIExvb2sgdXAgdGhlIGtleXMgb2YgdGhlIG9iamVjdC5cbiAgdmFyIHZpc2libGVLZXlzID0gZ2V0RW51bWVyYWJsZVByb3BlcnRpZXModmFsdWUpO1xuICB2YXIga2V5cyA9IGN0eC5zaG93SGlkZGVuID8gZ2V0UHJvcGVydGllcyh2YWx1ZSkgOiB2aXNpYmxlS2V5cztcblxuICAvLyBTb21lIHR5cGUgb2Ygb2JqZWN0IHdpdGhvdXQgcHJvcGVydGllcyBjYW4gYmUgc2hvcnRjdXR0ZWQuXG4gIC8vIEluIElFLCBlcnJvcnMgaGF2ZSBhIHNpbmdsZSBgc3RhY2tgIHByb3BlcnR5LCBvciBpZiB0aGV5IGFyZSB2YW5pbGxhIGBFcnJvcmAsXG4gIC8vIGEgYHN0YWNrYCBwbHVzIGBkZXNjcmlwdGlvbmAgcHJvcGVydHk7IGlnbm9yZSB0aG9zZSBmb3IgY29uc2lzdGVuY3kuXG4gIGlmIChrZXlzLmxlbmd0aCA9PT0gMCB8fCAoaXNFcnJvcih2YWx1ZSkgJiYgKFxuICAgICAgKGtleXMubGVuZ3RoID09PSAxICYmIGtleXNbMF0gPT09ICdzdGFjaycpIHx8XG4gICAgICAoa2V5cy5sZW5ndGggPT09IDIgJiYga2V5c1swXSA9PT0gJ2Rlc2NyaXB0aW9uJyAmJiBrZXlzWzFdID09PSAnc3RhY2snKVxuICAgICApKSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHZhciBuYW1lID0gZ2V0TmFtZSh2YWx1ZSk7XG4gICAgICB2YXIgbmFtZVN1ZmZpeCA9IG5hbWUgPyAnOiAnICsgbmFtZSA6ICcnO1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKCdbRnVuY3Rpb24nICsgbmFtZVN1ZmZpeCArICddJywgJ3NwZWNpYWwnKTtcbiAgICB9XG4gICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKFJlZ0V4cC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSksICdyZWdleHAnKTtcbiAgICB9XG4gICAgaWYgKGlzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBjdHguc3R5bGl6ZShEYXRlLnByb3RvdHlwZS50b1VUQ1N0cmluZy5jYWxsKHZhbHVlKSwgJ2RhdGUnKTtcbiAgICB9XG4gICAgaWYgKGlzRXJyb3IodmFsdWUpKSB7XG4gICAgICByZXR1cm4gZm9ybWF0RXJyb3IodmFsdWUpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBiYXNlID0gJycsIGFycmF5ID0gZmFsc2UsIGJyYWNlcyA9IFsneycsICd9J107XG5cbiAgLy8gTWFrZSBBcnJheSBzYXkgdGhhdCB0aGV5IGFyZSBBcnJheVxuICBpZiAoaXNBcnJheSh2YWx1ZSkpIHtcbiAgICBhcnJheSA9IHRydWU7XG4gICAgYnJhY2VzID0gWydbJywgJ10nXTtcbiAgfVxuXG4gIC8vIE1ha2UgZnVuY3Rpb25zIHNheSB0aGF0IHRoZXkgYXJlIGZ1bmN0aW9uc1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdmFyIG5hbWUgPSBnZXROYW1lKHZhbHVlKTtcbiAgICB2YXIgbmFtZVN1ZmZpeCA9IG5hbWUgPyAnOiAnICsgbmFtZSA6ICcnO1xuICAgIGJhc2UgPSAnIFtGdW5jdGlvbicgKyBuYW1lU3VmZml4ICsgJ10nO1xuICB9XG5cbiAgLy8gTWFrZSBSZWdFeHBzIHNheSB0aGF0IHRoZXkgYXJlIFJlZ0V4cHNcbiAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgIGJhc2UgPSAnICcgKyBSZWdFeHAucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpO1xuICB9XG5cbiAgLy8gTWFrZSBkYXRlcyB3aXRoIHByb3BlcnRpZXMgZmlyc3Qgc2F5IHRoZSBkYXRlXG4gIGlmIChpc0RhdGUodmFsdWUpKSB7XG4gICAgYmFzZSA9ICcgJyArIERhdGUucHJvdG90eXBlLnRvVVRDU3RyaW5nLmNhbGwodmFsdWUpO1xuICB9XG5cbiAgLy8gTWFrZSBlcnJvciB3aXRoIG1lc3NhZ2UgZmlyc3Qgc2F5IHRoZSBlcnJvclxuICBpZiAoaXNFcnJvcih2YWx1ZSkpIHtcbiAgICByZXR1cm4gZm9ybWF0RXJyb3IodmFsdWUpO1xuICB9XG5cbiAgaWYgKGtleXMubGVuZ3RoID09PSAwICYmICghYXJyYXkgfHwgdmFsdWUubGVuZ3RoID09IDApKSB7XG4gICAgcmV0dXJuIGJyYWNlc1swXSArIGJhc2UgKyBicmFjZXNbMV07XG4gIH1cblxuICBpZiAocmVjdXJzZVRpbWVzIDwgMCkge1xuICAgIGlmIChpc1JlZ0V4cCh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBjdHguc3R5bGl6ZShSZWdFeHAucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpLCAncmVnZXhwJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBjdHguc3R5bGl6ZSgnW09iamVjdF0nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgfVxuXG4gIGN0eC5zZWVuLnB1c2godmFsdWUpO1xuXG4gIHZhciBvdXRwdXQ7XG4gIGlmIChhcnJheSkge1xuICAgIG91dHB1dCA9IGZvcm1hdEFycmF5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleXMpO1xuICB9IGVsc2Uge1xuICAgIG91dHB1dCA9IGtleXMubWFwKGZ1bmN0aW9uKGtleSkge1xuICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleSwgYXJyYXkpO1xuICAgIH0pO1xuICB9XG5cbiAgY3R4LnNlZW4ucG9wKCk7XG5cbiAgcmV0dXJuIHJlZHVjZVRvU2luZ2xlU3RyaW5nKG91dHB1dCwgYmFzZSwgYnJhY2VzKTtcbn1cblxuXG5mdW5jdGlvbiBmb3JtYXRQcmltaXRpdmUoY3R4LCB2YWx1ZSkge1xuICBzd2l0Y2ggKHR5cGVvZiB2YWx1ZSkge1xuICAgIGNhc2UgJ3VuZGVmaW5lZCc6XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJ3VuZGVmaW5lZCcsICd1bmRlZmluZWQnKTtcblxuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICB2YXIgc2ltcGxlID0gJ1xcJycgKyBKU09OLnN0cmluZ2lmeSh2YWx1ZSkucmVwbGFjZSgvXlwifFwiJC9nLCAnJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoLycvZywgXCJcXFxcJ1wiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvXFxcXFwiL2csICdcIicpICsgJ1xcJyc7XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoc2ltcGxlLCAnc3RyaW5nJyk7XG5cbiAgICBjYXNlICdudW1iZXInOlxuICAgICAgaWYgKHZhbHVlID09PSAwICYmICgxL3ZhbHVlKSA9PT0gLUluZmluaXR5KSB7XG4gICAgICAgIHJldHVybiBjdHguc3R5bGl6ZSgnLTAnLCAnbnVtYmVyJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ251bWJlcicpO1xuXG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ2Jvb2xlYW4nKTtcbiAgfVxuICAvLyBGb3Igc29tZSByZWFzb24gdHlwZW9mIG51bGwgaXMgXCJvYmplY3RcIiwgc28gc3BlY2lhbCBjYXNlIGhlcmUuXG4gIGlmICh2YWx1ZSA9PT0gbnVsbCkge1xuICAgIHJldHVybiBjdHguc3R5bGl6ZSgnbnVsbCcsICdudWxsJyk7XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBmb3JtYXRFcnJvcih2YWx1ZSkge1xuICByZXR1cm4gJ1snICsgRXJyb3IucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpICsgJ10nO1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdEFycmF5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleXMpIHtcbiAgdmFyIG91dHB1dCA9IFtdO1xuICBmb3IgKHZhciBpID0gMCwgbCA9IHZhbHVlLmxlbmd0aDsgaSA8IGw7ICsraSkge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodmFsdWUsIFN0cmluZyhpKSkpIHtcbiAgICAgIG91dHB1dC5wdXNoKGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsXG4gICAgICAgICAgU3RyaW5nKGkpLCB0cnVlKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG91dHB1dC5wdXNoKCcnKTtcbiAgICB9XG4gIH1cbiAga2V5cy5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIGlmICgha2V5Lm1hdGNoKC9eXFxkKyQvKSkge1xuICAgICAgb3V0cHV0LnB1c2goZm9ybWF0UHJvcGVydHkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cyxcbiAgICAgICAgICBrZXksIHRydWUpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gb3V0cHV0O1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleSwgYXJyYXkpIHtcbiAgdmFyIG5hbWUsIHN0cjtcbiAgaWYgKHZhbHVlLl9fbG9va3VwR2V0dGVyX18pIHtcbiAgICBpZiAodmFsdWUuX19sb29rdXBHZXR0ZXJfXyhrZXkpKSB7XG4gICAgICBpZiAodmFsdWUuX19sb29rdXBTZXR0ZXJfXyhrZXkpKSB7XG4gICAgICAgIHN0ciA9IGN0eC5zdHlsaXplKCdbR2V0dGVyL1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RyID0gY3R4LnN0eWxpemUoJ1tHZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHZhbHVlLl9fbG9va3VwU2V0dGVyX18oa2V5KSkge1xuICAgICAgICBzdHIgPSBjdHguc3R5bGl6ZSgnW1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAodmlzaWJsZUtleXMuaW5kZXhPZihrZXkpIDwgMCkge1xuICAgIG5hbWUgPSAnWycgKyBrZXkgKyAnXSc7XG4gIH1cbiAgaWYgKCFzdHIpIHtcbiAgICBpZiAoY3R4LnNlZW4uaW5kZXhPZih2YWx1ZVtrZXldKSA8IDApIHtcbiAgICAgIGlmIChyZWN1cnNlVGltZXMgPT09IG51bGwpIHtcbiAgICAgICAgc3RyID0gZm9ybWF0VmFsdWUoY3R4LCB2YWx1ZVtrZXldLCBudWxsKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0ciA9IGZvcm1hdFZhbHVlKGN0eCwgdmFsdWVba2V5XSwgcmVjdXJzZVRpbWVzIC0gMSk7XG4gICAgICB9XG4gICAgICBpZiAoc3RyLmluZGV4T2YoJ1xcbicpID4gLTEpIHtcbiAgICAgICAgaWYgKGFycmF5KSB7XG4gICAgICAgICAgc3RyID0gc3RyLnNwbGl0KCdcXG4nKS5tYXAoZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgICAgcmV0dXJuICcgICcgKyBsaW5lO1xuICAgICAgICAgIH0pLmpvaW4oJ1xcbicpLnN1YnN0cigyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzdHIgPSAnXFxuJyArIHN0ci5zcGxpdCgnXFxuJykubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICAgIHJldHVybiAnICAgJyArIGxpbmU7XG4gICAgICAgICAgfSkuam9pbignXFxuJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc3RyID0gY3R4LnN0eWxpemUoJ1tDaXJjdWxhcl0nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIG5hbWUgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKGFycmF5ICYmIGtleS5tYXRjaCgvXlxcZCskLykpIHtcbiAgICAgIHJldHVybiBzdHI7XG4gICAgfVxuICAgIG5hbWUgPSBKU09OLnN0cmluZ2lmeSgnJyArIGtleSk7XG4gICAgaWYgKG5hbWUubWF0Y2goL15cIihbYS16QS1aX11bYS16QS1aXzAtOV0qKVwiJC8pKSB7XG4gICAgICBuYW1lID0gbmFtZS5zdWJzdHIoMSwgbmFtZS5sZW5ndGggLSAyKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnbmFtZScpO1xuICAgIH0gZWxzZSB7XG4gICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgLnJlcGxhY2UoL1xcXFxcIi9nLCAnXCInKVxuICAgICAgICAgICAgICAgICAucmVwbGFjZSgvKF5cInxcIiQpL2csIFwiJ1wiKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnc3RyaW5nJyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5hbWUgKyAnOiAnICsgc3RyO1xufVxuXG5cbmZ1bmN0aW9uIHJlZHVjZVRvU2luZ2xlU3RyaW5nKG91dHB1dCwgYmFzZSwgYnJhY2VzKSB7XG4gIHZhciBudW1MaW5lc0VzdCA9IDA7XG4gIHZhciBsZW5ndGggPSBvdXRwdXQucmVkdWNlKGZ1bmN0aW9uKHByZXYsIGN1cikge1xuICAgIG51bUxpbmVzRXN0Kys7XG4gICAgaWYgKGN1ci5pbmRleE9mKCdcXG4nKSA+PSAwKSBudW1MaW5lc0VzdCsrO1xuICAgIHJldHVybiBwcmV2ICsgY3VyLmxlbmd0aCArIDE7XG4gIH0sIDApO1xuXG4gIGlmIChsZW5ndGggPiA2MCkge1xuICAgIHJldHVybiBicmFjZXNbMF0gK1xuICAgICAgICAgICAoYmFzZSA9PT0gJycgPyAnJyA6IGJhc2UgKyAnXFxuICcpICtcbiAgICAgICAgICAgJyAnICtcbiAgICAgICAgICAgb3V0cHV0LmpvaW4oJyxcXG4gICcpICtcbiAgICAgICAgICAgJyAnICtcbiAgICAgICAgICAgYnJhY2VzWzFdO1xuICB9XG5cbiAgcmV0dXJuIGJyYWNlc1swXSArIGJhc2UgKyAnICcgKyBvdXRwdXQuam9pbignLCAnKSArICcgJyArIGJyYWNlc1sxXTtcbn1cblxuZnVuY3Rpb24gaXNBcnJheShhcikge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShhcikgfHxcbiAgICAgICAgICh0eXBlb2YgYXIgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKGFyKSA9PT0gJ1tvYmplY3QgQXJyYXldJyk7XG59XG5cbmZ1bmN0aW9uIGlzUmVnRXhwKHJlKSB7XG4gIHJldHVybiB0eXBlb2YgcmUgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKHJlKSA9PT0gJ1tvYmplY3QgUmVnRXhwXSc7XG59XG5cbmZ1bmN0aW9uIGlzRGF0ZShkKSB7XG4gIHJldHVybiB0eXBlb2YgZCA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoZCkgPT09ICdbb2JqZWN0IERhdGVdJztcbn1cblxuZnVuY3Rpb24gaXNFcnJvcihlKSB7XG4gIHJldHVybiB0eXBlb2YgZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoZSkgPT09ICdbb2JqZWN0IEVycm9yXSc7XG59XG5cbmZ1bmN0aW9uIG9iamVjdFRvU3RyaW5nKG8pIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKTtcbn1cbiIsIi8qIVxuICogQ2hhaSAtIGZsYWcgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogTW9kdWxlIGRlcGVuZGFuY2llc1xuICovXG5cbnZhciBpbnNwZWN0ID0gcmVxdWlyZSgnLi9pbnNwZWN0Jyk7XG52YXIgY29uZmlnID0gcmVxdWlyZSgnLi4vY29uZmlnJyk7XG5cbi8qKlxuICogIyMjIC5vYmpEaXNwbGF5IChvYmplY3QpXG4gKlxuICogRGV0ZXJtaW5lcyBpZiBhbiBvYmplY3Qgb3IgYW4gYXJyYXkgbWF0Y2hlc1xuICogY3JpdGVyaWEgdG8gYmUgaW5zcGVjdGVkIGluLWxpbmUgZm9yIGVycm9yXG4gKiBtZXNzYWdlcyBvciBzaG91bGQgYmUgdHJ1bmNhdGVkLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IGphdmFzY3JpcHQgb2JqZWN0IHRvIGluc3BlY3RcbiAqIEBuYW1lIG9iakRpc3BsYXlcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHZhciBzdHIgPSBpbnNwZWN0KG9iailcbiAgICAsIHR5cGUgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqKTtcblxuICBpZiAoY29uZmlnLnRydW5jYXRlVGhyZXNob2xkICYmIHN0ci5sZW5ndGggPj0gY29uZmlnLnRydW5jYXRlVGhyZXNob2xkKSB7XG4gICAgaWYgKHR5cGUgPT09ICdbb2JqZWN0IEZ1bmN0aW9uXScpIHtcbiAgICAgIHJldHVybiAhb2JqLm5hbWUgfHwgb2JqLm5hbWUgPT09ICcnXG4gICAgICAgID8gJ1tGdW5jdGlvbl0nXG4gICAgICAgIDogJ1tGdW5jdGlvbjogJyArIG9iai5uYW1lICsgJ10nO1xuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ1tvYmplY3QgQXJyYXldJykge1xuICAgICAgcmV0dXJuICdbIEFycmF5KCcgKyBvYmoubGVuZ3RoICsgJykgXSc7XG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnW29iamVjdCBPYmplY3RdJykge1xuICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhvYmopXG4gICAgICAgICwga3N0ciA9IGtleXMubGVuZ3RoID4gMlxuICAgICAgICAgID8ga2V5cy5zcGxpY2UoMCwgMikuam9pbignLCAnKSArICcsIC4uLidcbiAgICAgICAgICA6IGtleXMuam9pbignLCAnKTtcbiAgICAgIHJldHVybiAneyBPYmplY3QgKCcgKyBrc3RyICsgJykgfSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBzdHI7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBzdHI7XG4gIH1cbn07XG4iLCIvKiFcbiAqIENoYWkgLSBvdmVyd3JpdGVDaGFpbmFibGVNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIG92ZXJ3cml0ZUNoYWluYWJsZU1ldGhvZCAoY3R4LCBuYW1lLCBtZXRob2QsIGNoYWluaW5nQmVoYXZpb3IpXG4gKlxuICogT3ZlcndpdGVzIGFuIGFscmVhZHkgZXhpc3RpbmcgY2hhaW5hYmxlIG1ldGhvZFxuICogYW5kIHByb3ZpZGVzIGFjY2VzcyB0byB0aGUgcHJldmlvdXMgZnVuY3Rpb24gb3JcbiAqIHByb3BlcnR5LiAgTXVzdCByZXR1cm4gZnVuY3Rpb25zIHRvIGJlIHVzZWQgZm9yXG4gKiBuYW1lLlxuICpcbiAqICAgICB1dGlscy5vdmVyd3JpdGVDaGFpbmFibGVNZXRob2QoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnbGVuZ3RoJyxcbiAqICAgICAgIGZ1bmN0aW9uIChfc3VwZXIpIHtcbiAqICAgICAgIH1cbiAqICAgICAsIGZ1bmN0aW9uIChfc3VwZXIpIHtcbiAqICAgICAgIH1cbiAqICAgICApO1xuICpcbiAqIENhbiBhbHNvIGJlIGFjY2Vzc2VkIGRpcmVjdGx5IGZyb20gYGNoYWkuQXNzZXJ0aW9uYC5cbiAqXG4gKiAgICAgY2hhaS5Bc3NlcnRpb24ub3ZlcndyaXRlQ2hhaW5hYmxlTWV0aG9kKCdmb28nLCBmbiwgZm4pO1xuICpcbiAqIFRoZW4gY2FuIGJlIHVzZWQgYXMgYW55IG90aGVyIGFzc2VydGlvbi5cbiAqXG4gKiAgICAgZXhwZWN0KG15Rm9vKS50by5oYXZlLmxlbmd0aCgzKTtcbiAqICAgICBleHBlY3QobXlGb28pLnRvLmhhdmUubGVuZ3RoLmFib3ZlKDMpO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHdob3NlIG1ldGhvZCAvIHByb3BlcnR5IGlzIHRvIGJlIG92ZXJ3cml0dGVuXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBvZiBtZXRob2QgLyBwcm9wZXJ0eSB0byBvdmVyd3JpdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IG1ldGhvZCBmdW5jdGlvbiB0aGF0IHJldHVybnMgYSBmdW5jdGlvbiB0byBiZSB1c2VkIGZvciBuYW1lXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjaGFpbmluZ0JlaGF2aW9yIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIHByb3BlcnR5XG4gKiBAbmFtZSBvdmVyd3JpdGVDaGFpbmFibGVNZXRob2RcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBtZXRob2QsIGNoYWluaW5nQmVoYXZpb3IpIHtcbiAgdmFyIGNoYWluYWJsZUJlaGF2aW9yID0gY3R4Ll9fbWV0aG9kc1tuYW1lXTtcblxuICB2YXIgX2NoYWluaW5nQmVoYXZpb3IgPSBjaGFpbmFibGVCZWhhdmlvci5jaGFpbmluZ0JlaGF2aW9yO1xuICBjaGFpbmFibGVCZWhhdmlvci5jaGFpbmluZ0JlaGF2aW9yID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciByZXN1bHQgPSBjaGFpbmluZ0JlaGF2aW9yKF9jaGFpbmluZ0JlaGF2aW9yKS5jYWxsKHRoaXMpO1xuICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gIH07XG5cbiAgdmFyIF9tZXRob2QgPSBjaGFpbmFibGVCZWhhdmlvci5tZXRob2Q7XG4gIGNoYWluYWJsZUJlaGF2aW9yLm1ldGhvZCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcmVzdWx0ID0gbWV0aG9kKF9tZXRob2QpLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gdW5kZWZpbmVkID8gdGhpcyA6IHJlc3VsdDtcbiAgfTtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBvdmVyd3JpdGVNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIG92ZXJ3cml0ZU1ldGhvZCAoY3R4LCBuYW1lLCBmbilcbiAqXG4gKiBPdmVyd2l0ZXMgYW4gYWxyZWFkeSBleGlzdGluZyBtZXRob2QgYW5kIHByb3ZpZGVzXG4gKiBhY2Nlc3MgdG8gcHJldmlvdXMgZnVuY3Rpb24uIE11c3QgcmV0dXJuIGZ1bmN0aW9uXG4gKiB0byBiZSB1c2VkIGZvciBuYW1lLlxuICpcbiAqICAgICB1dGlscy5vdmVyd3JpdGVNZXRob2QoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnZXF1YWwnLCBmdW5jdGlvbiAoX3N1cGVyKSB7XG4gKiAgICAgICByZXR1cm4gZnVuY3Rpb24gKHN0cikge1xuICogICAgICAgICB2YXIgb2JqID0gdXRpbHMuZmxhZyh0aGlzLCAnb2JqZWN0Jyk7XG4gKiAgICAgICAgIGlmIChvYmogaW5zdGFuY2VvZiBGb28pIHtcbiAqICAgICAgICAgICBuZXcgY2hhaS5Bc3NlcnRpb24ob2JqLnZhbHVlKS50by5lcXVhbChzdHIpO1xuICogICAgICAgICB9IGVsc2Uge1xuICogICAgICAgICAgIF9zdXBlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICogICAgICAgICB9XG4gKiAgICAgICB9XG4gKiAgICAgfSk7XG4gKlxuICogQ2FuIGFsc28gYmUgYWNjZXNzZWQgZGlyZWN0bHkgZnJvbSBgY2hhaS5Bc3NlcnRpb25gLlxuICpcbiAqICAgICBjaGFpLkFzc2VydGlvbi5vdmVyd3JpdGVNZXRob2QoJ2ZvbycsIGZuKTtcbiAqXG4gKiBUaGVuIGNhbiBiZSB1c2VkIGFzIGFueSBvdGhlciBhc3NlcnRpb24uXG4gKlxuICogICAgIGV4cGVjdChteUZvbykudG8uZXF1YWwoJ2JhcicpO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHdob3NlIG1ldGhvZCBpcyB0byBiZSBvdmVyd3JpdHRlblxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgbWV0aG9kIHRvIG92ZXJ3cml0ZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gbWV0aG9kIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIG5hbWVcbiAqIEBuYW1lIG92ZXJ3cml0ZU1ldGhvZFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjdHgsIG5hbWUsIG1ldGhvZCkge1xuICB2YXIgX21ldGhvZCA9IGN0eFtuYW1lXVxuICAgICwgX3N1cGVyID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfTtcblxuICBpZiAoX21ldGhvZCAmJiAnZnVuY3Rpb24nID09PSB0eXBlb2YgX21ldGhvZClcbiAgICBfc3VwZXIgPSBfbWV0aG9kO1xuXG4gIGN0eFtuYW1lXSA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcmVzdWx0ID0gbWV0aG9kKF9zdXBlcikuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICByZXR1cm4gcmVzdWx0ID09PSB1bmRlZmluZWQgPyB0aGlzIDogcmVzdWx0O1xuICB9XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gb3ZlcndyaXRlUHJvcGVydHkgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIG92ZXJ3cml0ZVByb3BlcnR5IChjdHgsIG5hbWUsIGZuKVxuICpcbiAqIE92ZXJ3aXRlcyBhbiBhbHJlYWR5IGV4aXN0aW5nIHByb3BlcnR5IGdldHRlciBhbmQgcHJvdmlkZXNcbiAqIGFjY2VzcyB0byBwcmV2aW91cyB2YWx1ZS4gTXVzdCByZXR1cm4gZnVuY3Rpb24gdG8gdXNlIGFzIGdldHRlci5cbiAqXG4gKiAgICAgdXRpbHMub3ZlcndyaXRlUHJvcGVydHkoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnb2snLCBmdW5jdGlvbiAoX3N1cGVyKSB7XG4gKiAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICogICAgICAgICB2YXIgb2JqID0gdXRpbHMuZmxhZyh0aGlzLCAnb2JqZWN0Jyk7XG4gKiAgICAgICAgIGlmIChvYmogaW5zdGFuY2VvZiBGb28pIHtcbiAqICAgICAgICAgICBuZXcgY2hhaS5Bc3NlcnRpb24ob2JqLm5hbWUpLnRvLmVxdWFsKCdiYXInKTtcbiAqICAgICAgICAgfSBlbHNlIHtcbiAqICAgICAgICAgICBfc3VwZXIuY2FsbCh0aGlzKTtcbiAqICAgICAgICAgfVxuICogICAgICAgfVxuICogICAgIH0pO1xuICpcbiAqXG4gKiBDYW4gYWxzbyBiZSBhY2Nlc3NlZCBkaXJlY3RseSBmcm9tIGBjaGFpLkFzc2VydGlvbmAuXG4gKlxuICogICAgIGNoYWkuQXNzZXJ0aW9uLm92ZXJ3cml0ZVByb3BlcnR5KCdmb28nLCBmbik7XG4gKlxuICogVGhlbiBjYW4gYmUgdXNlZCBhcyBhbnkgb3RoZXIgYXNzZXJ0aW9uLlxuICpcbiAqICAgICBleHBlY3QobXlGb28pLnRvLmJlLm9rO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHdob3NlIHByb3BlcnR5IGlzIHRvIGJlIG92ZXJ3cml0dGVuXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBvZiBwcm9wZXJ0eSB0byBvdmVyd3JpdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGdldHRlciBmdW5jdGlvbiB0aGF0IHJldHVybnMgYSBnZXR0ZXIgZnVuY3Rpb24gdG8gYmUgdXNlZCBmb3IgbmFtZVxuICogQG5hbWUgb3ZlcndyaXRlUHJvcGVydHlcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBnZXR0ZXIpIHtcbiAgdmFyIF9nZXQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKGN0eCwgbmFtZSlcbiAgICAsIF9zdXBlciA9IGZ1bmN0aW9uICgpIHt9O1xuXG4gIGlmIChfZ2V0ICYmICdmdW5jdGlvbicgPT09IHR5cGVvZiBfZ2V0LmdldClcbiAgICBfc3VwZXIgPSBfZ2V0LmdldFxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShjdHgsIG5hbWUsXG4gICAgeyBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IGdldHRlcihfc3VwZXIpLmNhbGwodGhpcyk7XG4gICAgICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gICAgICB9XG4gICAgLCBjb25maWd1cmFibGU6IHRydWVcbiAgfSk7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gdGVzdCB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBNb2R1bGUgZGVwZW5kYW5jaWVzXG4gKi9cblxudmFyIGZsYWcgPSByZXF1aXJlKCcuL2ZsYWcnKTtcblxuLyoqXG4gKiAjIHRlc3Qob2JqZWN0LCBleHByZXNzaW9uKVxuICpcbiAqIFRlc3QgYW5kIG9iamVjdCBmb3IgZXhwcmVzc2lvbi5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IChjb25zdHJ1Y3RlZCBBc3NlcnRpb24pXG4gKiBAcGFyYW0ge0FyZ3VtZW50c30gY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLmFzc2VydCBhcmd1bWVudHNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmosIGFyZ3MpIHtcbiAgdmFyIG5lZ2F0ZSA9IGZsYWcob2JqLCAnbmVnYXRlJylcbiAgICAsIGV4cHIgPSBhcmdzWzBdO1xuICByZXR1cm4gbmVnYXRlID8gIWV4cHIgOiBleHByO1xufTtcbiIsIi8qIVxuICogQ2hhaSAtIHRyYW5zZmVyRmxhZ3MgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIHRyYW5zZmVyRmxhZ3MoYXNzZXJ0aW9uLCBvYmplY3QsIGluY2x1ZGVBbGwgPSB0cnVlKVxuICpcbiAqIFRyYW5zZmVyIGFsbCB0aGUgZmxhZ3MgZm9yIGBhc3NlcnRpb25gIHRvIGBvYmplY3RgLiBJZlxuICogYGluY2x1ZGVBbGxgIGlzIHNldCB0byBgZmFsc2VgLCB0aGVuIHRoZSBiYXNlIENoYWlcbiAqIGFzc2VydGlvbiBmbGFncyAobmFtZWx5IGBvYmplY3RgLCBgc3NmaWAsIGFuZCBgbWVzc2FnZWApXG4gKiB3aWxsIG5vdCBiZSB0cmFuc2ZlcnJlZC5cbiAqXG4gKlxuICogICAgIHZhciBuZXdBc3NlcnRpb24gPSBuZXcgQXNzZXJ0aW9uKCk7XG4gKiAgICAgdXRpbHMudHJhbnNmZXJGbGFncyhhc3NlcnRpb24sIG5ld0Fzc2VydGlvbik7XG4gKlxuICogICAgIHZhciBhbm90aGVyQXNzZXJpdG9uID0gbmV3IEFzc2VydGlvbihteU9iaik7XG4gKiAgICAgdXRpbHMudHJhbnNmZXJGbGFncyhhc3NlcnRpb24sIGFub3RoZXJBc3NlcnRpb24sIGZhbHNlKTtcbiAqXG4gKiBAcGFyYW0ge0Fzc2VydGlvbn0gYXNzZXJ0aW9uIHRoZSBhc3NlcnRpb24gdG8gdHJhbnNmZXIgdGhlIGZsYWdzIGZyb21cbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgdGhlIG9iamVjdCB0byB0cmFuc2ZlciB0aGUgZmxhZ3MgdG87IHVzdWFsbHkgYSBuZXcgYXNzZXJ0aW9uXG4gKiBAcGFyYW0ge0Jvb2xlYW59IGluY2x1ZGVBbGxcbiAqIEBuYW1lIHRyYW5zZmVyRmxhZ3NcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFzc2VydGlvbiwgb2JqZWN0LCBpbmNsdWRlQWxsKSB7XG4gIHZhciBmbGFncyA9IGFzc2VydGlvbi5fX2ZsYWdzIHx8IChhc3NlcnRpb24uX19mbGFncyA9IE9iamVjdC5jcmVhdGUobnVsbCkpO1xuXG4gIGlmICghb2JqZWN0Ll9fZmxhZ3MpIHtcbiAgICBvYmplY3QuX19mbGFncyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIH1cblxuICBpbmNsdWRlQWxsID0gYXJndW1lbnRzLmxlbmd0aCA9PT0gMyA/IGluY2x1ZGVBbGwgOiB0cnVlO1xuXG4gIGZvciAodmFyIGZsYWcgaW4gZmxhZ3MpIHtcbiAgICBpZiAoaW5jbHVkZUFsbCB8fFxuICAgICAgICAoZmxhZyAhPT0gJ29iamVjdCcgJiYgZmxhZyAhPT0gJ3NzZmknICYmIGZsYWcgIT0gJ21lc3NhZ2UnKSkge1xuICAgICAgb2JqZWN0Ll9fZmxhZ3NbZmxhZ10gPSBmbGFnc1tmbGFnXTtcbiAgICB9XG4gIH1cbn07XG4iLCIvKiFcbiAqIENoYWkgLSB0eXBlIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBNSVQgTGljZW5zZWRcbiAqL1xuXG4vKiFcbiAqIERldGVjdGFibGUgamF2YXNjcmlwdCBuYXRpdmVzXG4gKi9cblxudmFyIG5hdGl2ZXMgPSB7XG4gICAgJ1tvYmplY3QgQXJndW1lbnRzXSc6ICdhcmd1bWVudHMnXG4gICwgJ1tvYmplY3QgQXJyYXldJzogJ2FycmF5J1xuICAsICdbb2JqZWN0IERhdGVdJzogJ2RhdGUnXG4gICwgJ1tvYmplY3QgRnVuY3Rpb25dJzogJ2Z1bmN0aW9uJ1xuICAsICdbb2JqZWN0IE51bWJlcl0nOiAnbnVtYmVyJ1xuICAsICdbb2JqZWN0IFJlZ0V4cF0nOiAncmVnZXhwJ1xuICAsICdbb2JqZWN0IFN0cmluZ10nOiAnc3RyaW5nJ1xufTtcblxuLyoqXG4gKiAjIyMgdHlwZShvYmplY3QpXG4gKlxuICogQmV0dGVyIGltcGxlbWVudGF0aW9uIG9mIGB0eXBlb2ZgIGRldGVjdGlvbiB0aGF0IGNhblxuICogYmUgdXNlZCBjcm9zcy1icm93c2VyLiBIYW5kbGVzIHRoZSBpbmNvbnNpc3RlbmNpZXMgb2ZcbiAqIEFycmF5LCBgbnVsbGAsIGFuZCBgdW5kZWZpbmVkYCBkZXRlY3Rpb24uXG4gKlxuICogICAgIHV0aWxzLnR5cGUoe30pIC8vICdvYmplY3QnXG4gKiAgICAgdXRpbHMudHlwZShudWxsKSAvLyBgbnVsbCdcbiAqICAgICB1dGlscy50eXBlKHVuZGVmaW5lZCkgLy8gYHVuZGVmaW5lZGBcbiAqICAgICB1dGlscy50eXBlKFtdKSAvLyBgYXJyYXlgXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gb2JqZWN0IHRvIGRldGVjdCB0eXBlIG9mXG4gKiBAbmFtZSB0eXBlXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcbiAgdmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopO1xuICBpZiAobmF0aXZlc1tzdHJdKSByZXR1cm4gbmF0aXZlc1tzdHJdO1xuICBpZiAob2JqID09PSBudWxsKSByZXR1cm4gJ251bGwnO1xuICBpZiAob2JqID09PSB1bmRlZmluZWQpIHJldHVybiAndW5kZWZpbmVkJztcbiAgaWYgKG9iaiA9PT0gT2JqZWN0KG9iaikpIHJldHVybiAnb2JqZWN0JztcbiAgcmV0dXJuIHR5cGVvZiBvYmo7XG59O1xuIiwiLyohXG4gKiBhc3NlcnRpb24tZXJyb3JcbiAqIENvcHlyaWdodChjKSAyMDEzIEpha2UgTHVlciA8amFrZUBxdWFsaWFuY3kuY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBSZXR1cm4gYSBmdW5jdGlvbiB0aGF0IHdpbGwgY29weSBwcm9wZXJ0aWVzIGZyb21cbiAqIG9uZSBvYmplY3QgdG8gYW5vdGhlciBleGNsdWRpbmcgYW55IG9yaWdpbmFsbHlcbiAqIGxpc3RlZC4gUmV0dXJuZWQgZnVuY3Rpb24gd2lsbCBjcmVhdGUgYSBuZXcgYHt9YC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXhjbHVkZWQgcHJvcGVydGllcyAuLi5cbiAqIEByZXR1cm4ge0Z1bmN0aW9ufVxuICovXG5cbmZ1bmN0aW9uIGV4Y2x1ZGUgKCkge1xuICB2YXIgZXhjbHVkZXMgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgZnVuY3Rpb24gZXhjbHVkZVByb3BzIChyZXMsIG9iaikge1xuICAgIE9iamVjdC5rZXlzKG9iaikuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICBpZiAoIX5leGNsdWRlcy5pbmRleE9mKGtleSkpIHJlc1trZXldID0gb2JqW2tleV07XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gZXh0ZW5kRXhjbHVkZSAoKSB7XG4gICAgdmFyIGFyZ3MgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cylcbiAgICAgICwgaSA9IDBcbiAgICAgICwgcmVzID0ge307XG5cbiAgICBmb3IgKDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGV4Y2x1ZGVQcm9wcyhyZXMsIGFyZ3NbaV0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXM7XG4gIH07XG59O1xuXG4vKiFcbiAqIFByaW1hcnkgRXhwb3J0c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gQXNzZXJ0aW9uRXJyb3I7XG5cbi8qKlxuICogIyMjIEFzc2VydGlvbkVycm9yXG4gKlxuICogQW4gZXh0ZW5zaW9uIG9mIHRoZSBKYXZhU2NyaXB0IGBFcnJvcmAgY29uc3RydWN0b3IgZm9yXG4gKiBhc3NlcnRpb24gYW5kIHZhbGlkYXRpb24gc2NlbmFyaW9zLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gKiBAcGFyYW0ge09iamVjdH0gcHJvcGVydGllcyB0byBpbmNsdWRlIChvcHRpb25hbClcbiAqIEBwYXJhbSB7Y2FsbGVlfSBzdGFydCBzdGFjayBmdW5jdGlvbiAob3B0aW9uYWwpXG4gKi9cblxuZnVuY3Rpb24gQXNzZXJ0aW9uRXJyb3IgKG1lc3NhZ2UsIF9wcm9wcywgc3NmKSB7XG4gIHZhciBleHRlbmQgPSBleGNsdWRlKCduYW1lJywgJ21lc3NhZ2UnLCAnc3RhY2snLCAnY29uc3RydWN0b3InLCAndG9KU09OJylcbiAgICAsIHByb3BzID0gZXh0ZW5kKF9wcm9wcyB8fCB7fSk7XG5cbiAgLy8gZGVmYXVsdCB2YWx1ZXNcbiAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZSB8fCAnVW5zcGVjaWZpZWQgQXNzZXJ0aW9uRXJyb3InO1xuICB0aGlzLnNob3dEaWZmID0gZmFsc2U7XG5cbiAgLy8gY29weSBmcm9tIHByb3BlcnRpZXNcbiAgZm9yICh2YXIga2V5IGluIHByb3BzKSB7XG4gICAgdGhpc1trZXldID0gcHJvcHNba2V5XTtcbiAgfVxuXG4gIC8vIGNhcHR1cmUgc3RhY2sgdHJhY2VcbiAgc3NmID0gc3NmIHx8IGFyZ3VtZW50cy5jYWxsZWU7XG4gIGlmIChzc2YgJiYgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UpIHtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCBzc2YpO1xuICB9XG59XG5cbi8qIVxuICogSW5oZXJpdCBmcm9tIEVycm9yLnByb3RvdHlwZVxuICovXG5cbkFzc2VydGlvbkVycm9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXJyb3IucHJvdG90eXBlKTtcblxuLyohXG4gKiBTdGF0aWNhbGx5IHNldCBuYW1lXG4gKi9cblxuQXNzZXJ0aW9uRXJyb3IucHJvdG90eXBlLm5hbWUgPSAnQXNzZXJ0aW9uRXJyb3InO1xuXG4vKiFcbiAqIEVuc3VyZSBjb3JyZWN0IGNvbnN0cnVjdG9yXG4gKi9cblxuQXNzZXJ0aW9uRXJyb3IucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gQXNzZXJ0aW9uRXJyb3I7XG5cbi8qKlxuICogQWxsb3cgZXJyb3JzIHRvIGJlIGNvbnZlcnRlZCB0byBKU09OIGZvciBzdGF0aWMgdHJhbnNmZXIuXG4gKlxuICogQHBhcmFtIHtCb29sZWFufSBpbmNsdWRlIHN0YWNrIChkZWZhdWx0OiBgdHJ1ZWApXG4gKiBAcmV0dXJuIHtPYmplY3R9IG9iamVjdCB0aGF0IGNhbiBiZSBgSlNPTi5zdHJpbmdpZnlgXG4gKi9cblxuQXNzZXJ0aW9uRXJyb3IucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIChzdGFjaykge1xuICB2YXIgZXh0ZW5kID0gZXhjbHVkZSgnY29uc3RydWN0b3InLCAndG9KU09OJywgJ3N0YWNrJylcbiAgICAsIHByb3BzID0gZXh0ZW5kKHsgbmFtZTogdGhpcy5uYW1lIH0sIHRoaXMpO1xuXG4gIC8vIGluY2x1ZGUgc3RhY2sgaWYgZXhpc3RzIGFuZCBub3QgdHVybmVkIG9mZlxuICBpZiAoZmFsc2UgIT09IHN0YWNrICYmIHRoaXMuc3RhY2spIHtcbiAgICBwcm9wcy5zdGFjayA9IHRoaXMuc3RhY2s7XG4gIH1cblxuICByZXR1cm4gcHJvcHM7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2xpYi9lcWwnKTtcbiIsIi8qIVxuICogZGVlcC1lcWxcbiAqIENvcHlyaWdodChjKSAyMDEzIEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzXG4gKi9cblxudmFyIHR5cGUgPSByZXF1aXJlKCd0eXBlLWRldGVjdCcpO1xuXG4vKiFcbiAqIEJ1ZmZlci5pc0J1ZmZlciBicm93c2VyIHNoaW1cbiAqL1xuXG52YXIgQnVmZmVyO1xudHJ5IHsgQnVmZmVyID0gcmVxdWlyZSgnYnVmZmVyJykuQnVmZmVyOyB9XG5jYXRjaChleCkge1xuICBCdWZmZXIgPSB7fTtcbiAgQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfVxufVxuXG4vKiFcbiAqIFByaW1hcnkgRXhwb3J0XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBkZWVwRXF1YWw7XG5cbi8qKlxuICogQXNzZXJ0IHN1cGVyLXN0cmljdCAoZWdhbCkgZXF1YWxpdHkgYmV0d2VlblxuICogdHdvIG9iamVjdHMgb2YgYW55IHR5cGUuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gYVxuICogQHBhcmFtIHtNaXhlZH0gYlxuICogQHBhcmFtIHtBcnJheX0gbWVtb2lzZWQgKG9wdGlvbmFsKVxuICogQHJldHVybiB7Qm9vbGVhbn0gZXF1YWwgbWF0Y2hcbiAqL1xuXG5mdW5jdGlvbiBkZWVwRXF1YWwoYSwgYiwgbSkge1xuICBpZiAoc2FtZVZhbHVlKGEsIGIpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gZWxzZSBpZiAoJ2RhdGUnID09PSB0eXBlKGEpKSB7XG4gICAgcmV0dXJuIGRhdGVFcXVhbChhLCBiKTtcbiAgfSBlbHNlIGlmICgncmVnZXhwJyA9PT0gdHlwZShhKSkge1xuICAgIHJldHVybiByZWdleHBFcXVhbChhLCBiKTtcbiAgfSBlbHNlIGlmIChCdWZmZXIuaXNCdWZmZXIoYSkpIHtcbiAgICByZXR1cm4gYnVmZmVyRXF1YWwoYSwgYik7XG4gIH0gZWxzZSBpZiAoJ2FyZ3VtZW50cycgPT09IHR5cGUoYSkpIHtcbiAgICByZXR1cm4gYXJndW1lbnRzRXF1YWwoYSwgYiwgbSk7XG4gIH0gZWxzZSBpZiAoIXR5cGVFcXVhbChhLCBiKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSBlbHNlIGlmICgoJ29iamVjdCcgIT09IHR5cGUoYSkgJiYgJ29iamVjdCcgIT09IHR5cGUoYikpXG4gICYmICgnYXJyYXknICE9PSB0eXBlKGEpICYmICdhcnJheScgIT09IHR5cGUoYikpKSB7XG4gICAgcmV0dXJuIHNhbWVWYWx1ZShhLCBiKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqZWN0RXF1YWwoYSwgYiwgbSk7XG4gIH1cbn1cblxuLyohXG4gKiBTdHJpY3QgKGVnYWwpIGVxdWFsaXR5IHRlc3QuIEVuc3VyZXMgdGhhdCBOYU4gYWx3YXlzXG4gKiBlcXVhbHMgTmFOIGFuZCBgLTBgIGRvZXMgbm90IGVxdWFsIGArMGAuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gYVxuICogQHBhcmFtIHtNaXhlZH0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gZXF1YWwgbWF0Y2hcbiAqL1xuXG5mdW5jdGlvbiBzYW1lVmFsdWUoYSwgYikge1xuICBpZiAoYSA9PT0gYikgcmV0dXJuIGEgIT09IDAgfHwgMSAvIGEgPT09IDEgLyBiO1xuICByZXR1cm4gYSAhPT0gYSAmJiBiICE9PSBiO1xufVxuXG4vKiFcbiAqIENvbXBhcmUgdGhlIHR5cGVzIG9mIHR3byBnaXZlbiBvYmplY3RzIGFuZFxuICogcmV0dXJuIGlmIHRoZXkgYXJlIGVxdWFsLiBOb3RlIHRoYXQgYW4gQXJyYXlcbiAqIGhhcyBhIHR5cGUgb2YgYGFycmF5YCAobm90IGBvYmplY3RgKSBhbmQgYXJndW1lbnRzXG4gKiBoYXZlIGEgdHlwZSBvZiBgYXJndW1lbnRzYCAobm90IGBhcnJheWAvYG9iamVjdGApLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IGFcbiAqIEBwYXJhbSB7TWl4ZWR9IGJcbiAqIEByZXR1cm4ge0Jvb2xlYW59IHJlc3VsdFxuICovXG5cbmZ1bmN0aW9uIHR5cGVFcXVhbChhLCBiKSB7XG4gIHJldHVybiB0eXBlKGEpID09PSB0eXBlKGIpO1xufVxuXG4vKiFcbiAqIENvbXBhcmUgdHdvIERhdGUgb2JqZWN0cyBieSBhc3NlcnRpbmcgdGhhdFxuICogdGhlIHRpbWUgdmFsdWVzIGFyZSBlcXVhbCB1c2luZyBgc2F2ZVZhbHVlYC5cbiAqXG4gKiBAcGFyYW0ge0RhdGV9IGFcbiAqIEBwYXJhbSB7RGF0ZX0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gZGF0ZUVxdWFsKGEsIGIpIHtcbiAgaWYgKCdkYXRlJyAhPT0gdHlwZShiKSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gc2FtZVZhbHVlKGEuZ2V0VGltZSgpLCBiLmdldFRpbWUoKSk7XG59XG5cbi8qIVxuICogQ29tcGFyZSB0d28gcmVndWxhciBleHByZXNzaW9ucyBieSBjb252ZXJ0aW5nIHRoZW1cbiAqIHRvIHN0cmluZyBhbmQgY2hlY2tpbmcgZm9yIGBzYW1lVmFsdWVgLlxuICpcbiAqIEBwYXJhbSB7UmVnRXhwfSBhXG4gKiBAcGFyYW0ge1JlZ0V4cH0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gcmVnZXhwRXF1YWwoYSwgYikge1xuICBpZiAoJ3JlZ2V4cCcgIT09IHR5cGUoYikpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHNhbWVWYWx1ZShhLnRvU3RyaW5nKCksIGIudG9TdHJpbmcoKSk7XG59XG5cbi8qIVxuICogQXNzZXJ0IGRlZXAgZXF1YWxpdHkgb2YgdHdvIGBhcmd1bWVudHNgIG9iamVjdHMuXG4gKiBVbmZvcnR1bmF0ZWx5LCB0aGVzZSBtdXN0IGJlIHNsaWNlZCB0byBhcnJheXNcbiAqIHByaW9yIHRvIHRlc3QgdG8gZW5zdXJlIG5vIGJhZCBiZWhhdmlvci5cbiAqXG4gKiBAcGFyYW0ge0FyZ3VtZW50c30gYVxuICogQHBhcmFtIHtBcmd1bWVudHN9IGJcbiAqIEBwYXJhbSB7QXJyYXl9IG1lbW9pemUgKG9wdGlvbmFsKVxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gYXJndW1lbnRzRXF1YWwoYSwgYiwgbSkge1xuICBpZiAoJ2FyZ3VtZW50cycgIT09IHR5cGUoYikpIHJldHVybiBmYWxzZTtcbiAgYSA9IFtdLnNsaWNlLmNhbGwoYSk7XG4gIGIgPSBbXS5zbGljZS5jYWxsKGIpO1xuICByZXR1cm4gZGVlcEVxdWFsKGEsIGIsIG0pO1xufVxuXG4vKiFcbiAqIEdldCBlbnVtZXJhYmxlIHByb3BlcnRpZXMgb2YgYSBnaXZlbiBvYmplY3QuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGFcbiAqIEByZXR1cm4ge0FycmF5fSBwcm9wZXJ0eSBuYW1lc1xuICovXG5cbmZ1bmN0aW9uIGVudW1lcmFibGUoYSkge1xuICB2YXIgcmVzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBhKSByZXMucHVzaChrZXkpO1xuICByZXR1cm4gcmVzO1xufVxuXG4vKiFcbiAqIFNpbXBsZSBlcXVhbGl0eSBmb3IgZmxhdCBpdGVyYWJsZSBvYmplY3RzXG4gKiBzdWNoIGFzIEFycmF5cyBvciBOb2RlLmpzIGJ1ZmZlcnMuXG4gKlxuICogQHBhcmFtIHtJdGVyYWJsZX0gYVxuICogQHBhcmFtIHtJdGVyYWJsZX0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gaXRlcmFibGVFcXVhbChhLCBiKSB7XG4gIGlmIChhLmxlbmd0aCAhPT0gIGIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIGkgPSAwO1xuICB2YXIgbWF0Y2ggPSB0cnVlO1xuXG4gIGZvciAoOyBpIDwgYS5sZW5ndGg7IGkrKykge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSB7XG4gICAgICBtYXRjaCA9IGZhbHNlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG1hdGNoO1xufVxuXG4vKiFcbiAqIEV4dGVuc2lvbiB0byBgaXRlcmFibGVFcXVhbGAgc3BlY2lmaWNhbGx5XG4gKiBmb3IgTm9kZS5qcyBCdWZmZXJzLlxuICpcbiAqIEBwYXJhbSB7QnVmZmVyfSBhXG4gKiBAcGFyYW0ge01peGVkfSBiXG4gKiBAcmV0dXJuIHtCb29sZWFufSByZXN1bHRcbiAqL1xuXG5mdW5jdGlvbiBidWZmZXJFcXVhbChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBpdGVyYWJsZUVxdWFsKGEsIGIpO1xufVxuXG4vKiFcbiAqIEJsb2NrIGZvciBgb2JqZWN0RXF1YWxgIGVuc3VyaW5nIG5vbi1leGlzdGluZ1xuICogdmFsdWVzIGRvbid0IGdldCBpbi5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSBvYmplY3RcbiAqIEByZXR1cm4ge0Jvb2xlYW59IHJlc3VsdFxuICovXG5cbmZ1bmN0aW9uIGlzVmFsdWUoYSkge1xuICByZXR1cm4gYSAhPT0gbnVsbCAmJiBhICE9PSB1bmRlZmluZWQ7XG59XG5cbi8qIVxuICogUmVjdXJzaXZlbHkgY2hlY2sgdGhlIGVxdWFsaXR5IG9mIHR3byBvYmplY3RzLlxuICogT25jZSBiYXNpYyBzYW1lbmVzcyBoYXMgYmVlbiBlc3RhYmxpc2hlZCBpdCB3aWxsXG4gKiBkZWZlciB0byBgZGVlcEVxdWFsYCBmb3IgZWFjaCBlbnVtZXJhYmxlIGtleVxuICogaW4gdGhlIG9iamVjdC5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSBhXG4gKiBAcGFyYW0ge01peGVkfSBiXG4gKiBAcmV0dXJuIHtCb29sZWFufSByZXN1bHRcbiAqL1xuXG5mdW5jdGlvbiBvYmplY3RFcXVhbChhLCBiLCBtKSB7XG4gIGlmICghaXNWYWx1ZShhKSB8fCAhaXNWYWx1ZShiKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICB2YXIgaTtcbiAgaWYgKG0pIHtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbS5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKChtW2ldWzBdID09PSBhICYmIG1baV1bMV0gPT09IGIpXG4gICAgICB8fCAgKG1baV1bMF0gPT09IGIgJiYgbVtpXVsxXSA9PT0gYSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIG0gPSBbXTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgdmFyIGthID0gZW51bWVyYWJsZShhKTtcbiAgICB2YXIga2IgPSBlbnVtZXJhYmxlKGIpO1xuICB9IGNhdGNoIChleCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGthLnNvcnQoKTtcbiAga2Iuc29ydCgpO1xuXG4gIGlmICghaXRlcmFibGVFcXVhbChrYSwga2IpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgbS5wdXNoKFsgYSwgYiBdKTtcblxuICB2YXIga2V5O1xuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldLCBtKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2xpYi90eXBlJyk7XG4iLCIvKiFcbiAqIHR5cGUtZGV0ZWN0XG4gKiBDb3B5cmlnaHQoYykgMjAxMyBqYWtlIGx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogUHJpbWFyeSBFeHBvcnRzXG4gKi9cblxudmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IGdldFR5cGU7XG5cbi8qIVxuICogRGV0ZWN0YWJsZSBqYXZhc2NyaXB0IG5hdGl2ZXNcbiAqL1xuXG52YXIgbmF0aXZlcyA9IHtcbiAgICAnW29iamVjdCBBcnJheV0nOiAnYXJyYXknXG4gICwgJ1tvYmplY3QgUmVnRXhwXSc6ICdyZWdleHAnXG4gICwgJ1tvYmplY3QgRnVuY3Rpb25dJzogJ2Z1bmN0aW9uJ1xuICAsICdbb2JqZWN0IEFyZ3VtZW50c10nOiAnYXJndW1lbnRzJ1xuICAsICdbb2JqZWN0IERhdGVdJzogJ2RhdGUnXG59O1xuXG4vKipcbiAqICMjIyB0eXBlT2YgKG9iailcbiAqXG4gKiBVc2Ugc2V2ZXJhbCBkaWZmZXJlbnQgdGVjaG5pcXVlcyB0byBkZXRlcm1pbmVcbiAqIHRoZSB0eXBlIG9mIG9iamVjdCBiZWluZyB0ZXN0ZWQuXG4gKlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IG9iamVjdFxuICogQHJldHVybiB7U3RyaW5nfSBvYmplY3QgdHlwZVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBnZXRUeXBlIChvYmopIHtcbiAgdmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopO1xuICBpZiAobmF0aXZlc1tzdHJdKSByZXR1cm4gbmF0aXZlc1tzdHJdO1xuICBpZiAob2JqID09PSBudWxsKSByZXR1cm4gJ251bGwnO1xuICBpZiAob2JqID09PSB1bmRlZmluZWQpIHJldHVybiAndW5kZWZpbmVkJztcbiAgaWYgKG9iaiA9PT0gT2JqZWN0KG9iaikpIHJldHVybiAnb2JqZWN0JztcbiAgcmV0dXJuIHR5cGVvZiBvYmo7XG59XG5cbmV4cG9ydHMuTGlicmFyeSA9IExpYnJhcnk7XG5cbi8qKlxuICogIyMjIExpYnJhcnlcbiAqXG4gKiBDcmVhdGUgYSByZXBvc2l0b3J5IGZvciBjdXN0b20gdHlwZSBkZXRlY3Rpb24uXG4gKlxuICogYGBganNcbiAqIHZhciBsaWIgPSBuZXcgdHlwZS5MaWJyYXJ5O1xuICogYGBgXG4gKlxuICovXG5cbmZ1bmN0aW9uIExpYnJhcnkgKCkge1xuICB0aGlzLnRlc3RzID0ge307XG59XG5cbi8qKlxuICogIyMjIyAub2YgKG9iailcbiAqXG4gKiBFeHBvc2UgcmVwbGFjZW1lbnQgYHR5cGVvZmAgZGV0ZWN0aW9uIHRvIHRoZSBsaWJyYXJ5LlxuICpcbiAqIGBgYGpzXG4gKiBpZiAoJ3N0cmluZycgPT09IGxpYi5vZignaGVsbG8gd29ybGQnKSkge1xuICogICAvLyAuLi5cbiAqIH1cbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IG9iamVjdCB0byB0ZXN0XG4gKiBAcmV0dXJuIHtTdHJpbmd9IHR5cGVcbiAqL1xuXG5MaWJyYXJ5LnByb3RvdHlwZS5vZiA9IGdldFR5cGU7XG5cbi8qKlxuICogIyMjIyAuZGVmaW5lICh0eXBlLCB0ZXN0KVxuICpcbiAqIEFkZCBhIHRlc3QgdG8gZm9yIHRoZSBgLnRlc3QoKWAgYXNzZXJ0aW9uLlxuICpcbiAqIENhbiBiZSBkZWZpbmVkIGFzIGEgcmVndWxhciBleHByZXNzaW9uOlxuICpcbiAqIGBgYGpzXG4gKiBsaWIuZGVmaW5lKCdpbnQnLCAvXlswLTldKyQvKTtcbiAqIGBgYFxuICpcbiAqIC4uLiBvciBhcyBhIGZ1bmN0aW9uOlxuICpcbiAqIGBgYGpzXG4gKiBsaWIuZGVmaW5lKCdibG4nLCBmdW5jdGlvbiAob2JqKSB7XG4gKiAgIGlmICgnYm9vbGVhbicgPT09IGxpYi5vZihvYmopKSByZXR1cm4gdHJ1ZTtcbiAqICAgdmFyIGJsbnMgPSBbICd5ZXMnLCAnbm8nLCAndHJ1ZScsICdmYWxzZScsIDEsIDAgXTtcbiAqICAgaWYgKCdzdHJpbmcnID09PSBsaWIub2Yob2JqKSkgb2JqID0gb2JqLnRvTG93ZXJDYXNlKCk7XG4gKiAgIHJldHVybiAhISB+Ymxucy5pbmRleE9mKG9iaik7XG4gKiB9KTtcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlXG4gKiBAcGFyYW0ge1JlZ0V4cHxGdW5jdGlvbn0gdGVzdFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5MaWJyYXJ5LnByb3RvdHlwZS5kZWZpbmUgPSBmdW5jdGlvbiAodHlwZSwgdGVzdCkge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHRoaXMudGVzdHNbdHlwZV07XG4gIHRoaXMudGVzdHNbdHlwZV0gPSB0ZXN0O1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogIyMjIyAudGVzdCAob2JqLCB0ZXN0KVxuICpcbiAqIEFzc2VydCB0aGF0IGFuIG9iamVjdCBpcyBvZiB0eXBlLiBXaWxsIGZpcnN0XG4gKiBjaGVjayBuYXRpdmVzLCBhbmQgaWYgdGhhdCBkb2VzIG5vdCBwYXNzIGl0IHdpbGxcbiAqIHVzZSB0aGUgdXNlciBkZWZpbmVkIGN1c3RvbSB0ZXN0cy5cbiAqXG4gKiBgYGBqc1xuICogYXNzZXJ0KGxpYi50ZXN0KCcxJywgJ2ludCcpKTtcbiAqIGFzc2VydChsaWIudGVzdCgneWVzJywgJ2JsbicpKTtcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IG9iamVjdFxuICogQHBhcmFtIHtTdHJpbmd9IHR5cGVcbiAqIEByZXR1cm4ge0Jvb2xlYW59IHJlc3VsdFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5MaWJyYXJ5LnByb3RvdHlwZS50ZXN0ID0gZnVuY3Rpb24gKG9iaiwgdHlwZSkge1xuICBpZiAodHlwZSA9PT0gZ2V0VHlwZShvYmopKSByZXR1cm4gdHJ1ZTtcbiAgdmFyIHRlc3QgPSB0aGlzLnRlc3RzW3R5cGVdO1xuXG4gIGlmICh0ZXN0ICYmICdyZWdleHAnID09PSBnZXRUeXBlKHRlc3QpKSB7XG4gICAgcmV0dXJuIHRlc3QudGVzdChvYmopO1xuICB9IGVsc2UgaWYgKHRlc3QgJiYgJ2Z1bmN0aW9uJyA9PT0gZ2V0VHlwZSh0ZXN0KSkge1xuICAgIHJldHVybiB0ZXN0KG9iaik7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFJlZmVyZW5jZUVycm9yKCdUeXBlIHRlc3QgXCInICsgdHlwZSArICdcIiBub3QgZGVmaW5lZCBvciBpbnZhbGlkLicpO1xuICB9XG59O1xuIiwidmFyIGV4cGVjdCA9IHJlcXVpcmUoJ2NoYWknKS5leHBlY3Q7XG5cbmRlc2NyaWJlKCd0ZXN0IHNldHVwJywgZnVuY3Rpb24oKSB7XG5cdGl0KCdzaG91bGQgd29yaycsIGZ1bmN0aW9uKCkge1xuXHRcdGV4cGVjdCh0cnVlKS50by5iZS50cnVlO1xuXHR9KTtcblx0aXQoJ3Nob3VsZCB3b3JrIGFnYWluJywgZnVuY3Rpb24oKSB7XG5cdFx0ZXhwZWN0KHRydWUpLnRvLmJlLnRydWU7XG5cdH0pO1xufSk7Il19
