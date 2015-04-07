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
      return c�F[7Cb�l�_J��2��!�(RH4\qm�2�ӿ|�up\C2B2w���IL)�����u��t�sd��wJѕQ�'@�U�5ڽ�(�[h3V'�wڜ�!ht`!������������M-�� F漏nW"-"��eV��� �S.�YU�h����KZLk���*'��QzL3dĲQ��L&�x�݀Z)�S�_���
O"�#T1%�ؼ�i��T�|�h֎	���>T���etqSY�� ��K�i\a��� ĥr�=����mON/�Y��7b%�'�`��M����xC�v����øR 򏇀�(b���~�!e�&�> ���W��Tq"���t�!$w^au���UϞ�$�0�`*b}+�m�F�m!3�lO���FN�'""b��a9�|ʊY8Ĩv��_2ܽ��\���'X&ΰN�x��D���e��Z��$B�
d��孰�����0�ۼ-� ��K$6�AD٤&�	��d���_��_B�<��p_��h��#�f��3_x��Ӵ�J�7.�mf�沊j�'��oV��η�+:��߽�=����^� �	#�2m�*Ako�a���z�����xF9$�F#waz�`�:��3�34%�D��C�R��]���*'϶��5����g��=L��}��}�' CW󁻢*�@u�*�/��)�F>3s��2-�"��=4P,���w���ʴ�G�A��_S�?hodj?e�9�L�tY��~��Ѻux1�l5�P��)�R'�:V�]��Gi��O�(�[A�g�[�"��AC�c�����˄�w��X�M7�i�\�É �B���]0/I�u����h�B0��O`A�A摷"ުi���_�^�)�T���2U^
�(ٿ���Ʒ�6���a�5VJ4�<b��բF*���#j��=H��D��ᨁ���a�\�4�Bk-���.��r����9����l���f�^��`�o�zbu �q�?�H�X��͌��}�{��>� *+C���B��ʦf�w�jYT`��� �H�dj&�@�(�{ڄ5��"����8'�{�*���_�w0�*Q����Ra=B[8�f��#�&���!@��}$�\<��u�5����j�%܀�A̯�+TC�?<��*u�N�Iu"���R�Ή�L}s�ǹ��J�:�mk7����I�+Ͱ~���Es��h��b�BH/|.Ac���f�������v�b�g�ŧQH����Y�~_���g3j����\��3˱�}��u0 喬~45�dTKƢ��/"1z�����.��#����a�Q�υ�<��#�ĭ3,��D�O���'(=?ʙ�N���{�|U�3kvg^�/;��9Sk��>�����2�{i`��I\�\e�B �������r��:Q�;�}�9�<�����C�G�1�~|ֆb$>'�⬬�W�<�˭�l�!�"�MU�*<�"�iqF��p��)׿iLQ,�����ju뇯�抎ᎂk�R2�͹4T��L[�+�}��a��@_�	@8�{0K������x�r�)D��V�'5lhV!��>uj��j�I��P��jBw?�CQ�>Kjs�k��]|1�lh��6���@�q!w��U�[�p;e���1,/�;
6��'�E5��mm��tE���x׾����}P�=T�IXcel�� �`���!����u���� ���G0�]��!)�ˀ6����"�J�fv�0ʭ�@��u�<.��������I��e�l�}>ӝF�`)����ڱ���N�4uF1�Vv�LZ/\Ap�[!���`�a���J����-%����/�ۮ��j�6}E����Jp�b�z�=����i�;�c7�Hk�_�"iu�/�
�
�����'J�cK0�%�N�'|S�)��T�e����i?��y4��}(���̥�I��&��m|�Q��E��T�f��4 ����7�E�����{�,}<��(�DH��5ʈ��p�w�L2S�����A�� �����*;�+�Z1��w^ �������8��g���!�#ЎH��I���s�;�}"�|l�S��a��L6!���U��i�b�;����y�M
�G�@��R��=Gc8�b.I�tx,�OՑ��n̮��l wU��%�������򂸎�9F��0�~�E�R�&G�RuƯjI�I�q_��.�>�w;�r��=C �N�.� �I���!%"�OY�������PD��L�/
B��S
͸i�e	�q�R���.'3�U]D�;��/o�m���"�1�o�:�pjQ��*SW'$������z:�\����y�ӡ5���j٬?`��M��.�O�~`��_���"
�����aj�46���_��$�w�3����y���$'�_ Bx��#*��e]q?�SL��V_6x8��_I�F$kZx`J�źŷRg���.�x���/�":aY�� Z��U�&z0���,��G1mx���m �<?�Ț�5�w�"c�az��������OA%��Va)I����6L3%l�F_k=L����ۥ���� ����a|�M�ވ!=+��V�x"��'�#@��?��0jp�&\_�Ѕ�,F`m]��k$1�8|ز�=`
<4ӧ�Y҉��_⻕O��$�e�퐤�\��]ii�{�8�8q��� +ѼsY�쎔�~��@K� ��͋>�M�]��~У���F��W�ҹ�B��6��7��(� SϦ?�r�����0�;�٫�8���nJ�X��]"�k�P�����it��W�H�xuq�,��.�B�@��"٫�Z�~S�<����.�	�E��p{���� ��;v��g�aT�&R���/�N��8{�2��ݻ�����""��SC�;���#���*�2`�\�Y��O �GM�I���]5�B�`��k죡�tB�V��%Y��sK/�L���ڎ�	P��6�j�����F	�P��)�1�Z��F����4CƶV���{n�Y��7�aQx-y�?���� _I]	�$�S�����
�8���s�p��~R�!�r�|��b��Y�f��Rb9�XdS�%=X�+u���$qȽ�8��a������4y����������eB�7yUD� ��#h%Re��y/ s1d�x̕�ٛ������zV������jn]\0�{awʘ�c_�Y1[�k�rB�(T���bWV5q^�DdW����J��MG�6#�I�0_��i���N&��PK %m���D��7�p^o4ϳ`M�2ʒHg�
�S���H@)�EvB�����E�v3j9:Օ�7�Ⱦ���sT�źSZ���Sp�r��e�VWwh�%�+�I�rf�J��I��s�z�;��61�%i��J������wGy��1�L��#��78�8i���!:�X���D�㓅�2�b�NٯZq}rz�x2w	a��f�z�K��GƬ���x��k\mΕ��F����	NP@l�_˙{��=xjfKM�رY�9a'x�X ce�V4��H|Y��9G�7X�$k�]���0�	��x�Dhc�fCЮc8&)�W:&a��S�6��0�_�l4�:5�uW>pY�'0��?C8`��ͬ��=i�O��KÈ�R�W����Xg�t 2�W�OPa�c�����Λ2�
�+|�Q�|uIf_�"�J�bM�`���w7��*P��&�?v2Jw���/�9u��sw/Q//D� ��o�Ua�F�-D�!|.��	��q��{X�9��~p�vG�rU�Y��-V��HF�o�I��o�Ϭo\�謳������ul`��L�s���O���;�ڡQ�5����y�`3(k| ��j�7��"����<3c�c�KX���d�������?�c�,v��0�˃{����K3�%��M�Ry�f|�y�4 d���Q �
�ĵe�7";����&TD`��S'$���Rm��؞���u�q�|'= ��>��#��R�Q&�7��]g��m�S�dss�u���[
;3��+7��+��*�͔x�[���{W�G��i����b��}�fvmRͷ�F�_���i��@��sz�h�ӿ�m喰�2t^�礂��������,$��!�5`��ƀԝn�!�Z:2l�S,���a㛍���Q��|�iT!W&��P�G`(0F�g�ȯ;{Ӗ^z�;i0��-I�(�F��L@!Ƙ��W��p� ��oEm�j��w��Ǆ�c�C�޳˻iE峒L�Q�ë�5�ĳ��*��'�n�%�����?,����T�;�c��mS2��}c�-�pLaւ��>�,��Ѱ*&t{Hy��h�ϚＵ{�_%
Q�%��S2�ls$?�*�"����vIfS���bhh���q��OW��0���_V�w�=�u��������phh:av��.ǭϸTW��;�ʫL5o�A��3�O�=����|!�S�Ǟ�B
]�2�4��&��L��l�&6�B������?wū����+ЉMe����gd����.����TQ�/� F�:a{��s�aU�-A��h��-ѬfC��z8�Ъ#����$�b$q� �=���9�?�Z��m�eՖ�91�$���������"�α��hߴ����#�Y���z�6����93 ��(jp�����˃9�]2�Zi���::1Ԗ)v��v&/���:L�k��Ӑ�}�z��VkQBT��Z3���u���� (˿3C��S7+�!�|��Q��j���0lH���d����|�,�����WP�\���3�u��G[Y>J�#�|�%�д(${E�>ߊ�wm!J��D�<�ڑ.�َLm3��w���!g�8��#�sw�W׏�E�e��1���J��r���ۉ�~��EK?��'װ2�DD'X������b,��!n�F�O�7�Y�J�Ll��?M�r�⨚���q�V�:C֤y�!zk��M�|�E����f�Dwh�,d�����pss����·1�`�*O$�*"���=A_��loe��l`�Ǻ �t�����pˈ d���y���5@��ӄ�(��o�3<T.�3/���r9Z�CKk��v�T��e�~�_O���ӭ}���0����#�RG�N��<u	����d�)��;�����[���T���#��y�.�f�oT��&P�oM\Ƹ#=(<��H�i
+A�-�x��ֻ��a���1����)Ǖ��&�yѠ�Z$�!�0�vr�!X���J�+&�~NH� ��L?��'�!��UD��1����) ��d;�K�9��spR�d�����X+�����y5���w3��Q��W��9,���X��q����Qu
(avL��uSG�ÛC��q�S�� j�͒��ȹ�����5p�r��=]���I�H�rb���9a;� #ӳa3e(�Ƌ�87����E�B ���m��,�:�����F�+t�1�-_�'\���w�.�O���V�h��o-���pܽh�'7��10BU�+�}��W�+Z�2�\��(݋�T������b���%�����M	n�4=��,$*�	0��P��P_���2}�
 ��va�N��o�+�UQ�:�5�賕�]�����|>n{��y�c�ot�-��_���A��k��W�vn��Yߋ����<f��p��?�7�X�V&�A?�T흺�
k���k�L�ʋ9��1w-�~��U��j]�;�5�l�"��&�����5A<�1����|�6L�bI�<f�Q�>�j���Fo�������p Qt&�D�1��}�0Q�b�^<v�R���<�/^�;��V�]N�R��ߖ�k3#�:+��Ҫ�j->����#`D��߱�l��R5��4�jݲ��O{����F�a�1�]PCL��������5a�}��䞤4Vf!��P��p�Kԏ$8���!�0��ߵ���jMg^���Q��mUf�9b�oG�c�`h�@Ɵ�,��z��=�@���w�W�^�ZX���R�X�2gi��b��s�,��I�s�}���^�6eyHM`�UP�ZH���Q(�����T�t�m�rSy=|$*�r0�Q�����F�˶dٰ�w���>�����G9�GJ�zn�Ԇ�R��jD��n(.\�zn�q�	t1Y��媫fB�3��D�ۋ�
�����e���gG���W�H�Ǳ|����|L�A�kO*.̷�bwB�`$��'#���
n"{	��M0��|�q{VH�h��4�����V�ޓ�����d��-�Fl|�+ͻ��__�0�y{+�wO�DN2���#}鳊D�ۋ���@^�x��F��>a�Y߯>c4������^fA0�/���fa2-��O�$��A�L(l�p����V��c @׈���n��	�I6W`��<�"3n�O��B�m����Â,���{�H؛�U��6��k�!jhl���éՑl[<�"F��E?H��J��Ɓ���!$ـH�<�"a���Y��(�bs�W2�ϩ  ���;
I��8�|I";$I��s�vi���Du��,N���N�][��I�^�	8QM7���L	� w�'4�_P#����
	�����t�9<�6�F�J� @�&� #d�#�ffSX8�h���3���B؟E��4�8��⥢�����M)W/�P�ۦ
� �����a�ס9���y�Rg�����!��C��d�7�,��e��Y����dGgK���"!�jQ�<�����Z�>�.w� ?BŚI��1џw)y�T>�$_}[�����h�ƛ�6�JyR�.5���Ɗ" �3���S����`5�6�G%�h^	e	�X�M?����_����2L�>��� m�놎K�#�nG��|��3k�ʭ� Ca;:]����9jja�����iXA�4��챘�;a��s(sSk�S�7���kr�^'�{�i-�Ma����dtqp� ~�^1�7ޭ�W�<:�|L��+G Bw�����G��gڃ�,M�`I��Re�梈A�7.��0T����Ε3VT?Є��{�U��+x�C�x��l���h��
:�\��	���eѓȅG 1�Y��B������+�5�������g����X�ݳ��k�p^bŻ��om�N!7�/(zC�4�I�ϔQ�.];U����@$��g�?a���ؠ�)+���:�I�䐇{�EߟZ�a~9Ɂ��Q�ψEE�l�2��<�j2*i@��(�ǜ�H`u�$ e�.��A��̊�[5X��ۭlxZ��Fؕ��W9�/V�*'R.V8�Y׾n����)��Y���6�I�u��n`L\�23��jx�9gc<υ�fR#�����>A��s��7���[ጢW�p���S�ig0
��+no9��	PJ�z����b��]s���ʛ���IA��f!l�NN��Ԣ\39+i~{e
4f$�5LU����Otc"���^�0N#���w��Y�|Q�CZ�Cy�&R����Z��H�:���I.)O���J:�!T͏�ab�<��^իXH0�C�`�)�����ZNu������a�i�9!&���A�V+.�^)6�ÆD�%r��&��/Oo�qJdΌrUZ
��W�r�:�`�0�}�n蹮_���&E���,�PIUƵy����FqKઍ����^��yMMU�i;�����џ\���a�����IX:'��[m�_U.�ɰh�xQ%k|nΉL�":Ƒ�#y��zm�����e����i�$9���T!�-�/�@�^��E�l�hC�\17T+p �	�5ή4y588�Ƨ�fX�M��V%��+O��mR��ֈ�,�'��з�}�6���}��<��C�hp�ĨmZ���c�9Cm�C��`G��q��[���Z6q�%�=����	������ЃG��9�V}��2� =�B,���HVMIv��<h=����'\7L!�%�-�(U��-0��(T�G`�
��K��4�%I�-���z�C��!K<�?eE����*~^{2����D���E�H�0�H4�"�C�����h6m-� ��o{���JFW>jЀp�vw�n,�cm�)��ph���z��#T@��\Z�:x��\ds8A�dF���/C<ԕ���O�����f�
���@4�FA�*eP&P��N�3>@�SWN�%��o�s}uy$�����Gջ�Ұ�h�@�R[���B��Fl��)M�ĐX�l1�嶟��1z��4��7��E�&� l3�:�1�,DZ�Tn3�)Z��F���B$"�����A�r4���q�W�!RU~���+��;u�~V��a��0@u�X�L��lt|t]��3aL�|��Q�E>�,_��`U�ۈa��Y�~W��P:�=�e������wE�^ j7���h�o FG(��0�K��&VuzY͢���Ex̪��)kkl;!ђ���Q��`��{�q�t�*�};_��M���;Bzc l�Y�g��$%�-���Gsd������ໍ�DV��� (�ה��yĂ�o9ƅ�u�k���䐵/��O��@w��v<QSWh��61L.�m-Y��x�;k�������3�f�(�φ�4���}��{g*wTB2�<���QQH�� ^`���(��x��u�"��R�G7ٹ?P��i��c3�y�:�pl��A�p�z�#����!�j��S�:��+I~�o����}
$��D
_���᭑��E�f���x�T���`�2Iծ��5g�U|y�9цɑ���ҕ�Ї0D�^�%�F��|n'#�NZ3����)��8V���k���L0_��7>�Cr���WS<c5�I��<
��o��y���~�e�!�3�N�Q��{�*���������Q�%�<7=��<C�ET����`�
G�=�D����&7�%o��7�G--�n�ꡚ�x1�?~n�����hv�!��]f�Md�ց@*��_mA����.I�h�ı�8����Y�.���*8����s�<Xh�֌�7���S�n�����k�;w��H��Љw���ΧZA?=������(1�Z2e�<��r�ҝ���I<��|T�Ž�fxʻa�x��}�Y�~Ep���甥ݜ,d�]�A�AB��Z]���J��\�r�/u���;��,�X&q&`o˫��VI��������T�X�����w�L����g�c�(,@r�!���w
�Ͻ#tb������U��Os�)g5ae�㙊����Xyߕn$�fNBu�Q,z+v沿iF��LC�id��@��^M)�Q�u9n��;�E�oFR�������W�㍀Jɛ��F�5ܔ�E�B"5
� R$We�}mdˤI�,�*[�ٗ�>����a�·�<F��l�-��<&8��dDO�~Č���Gs;��<%����r��5�_��%���k/��'D�$�(Č��ÜJ�_�wD*����1ĨP*�u�$�Qpn�9J�)DˁAҎ�24�c0{���kM������	���F��5��	g'"5 ;<���;_P}ӀO��Aq;�E�oyڢ�������NGgd�jC��d��G���^��E�"�]{����M-\�}l����(�-V@0����M,Ε
H彙<���g��˕_1���P�:��?NXJ����-
��l<��J��[Wp2[�&�*��m�%,�n��IY+��%�T�iG�L�[D{5�L5��3JP��|�
����)��wr�ق�@{����7A�?50��_�C�$�?\̀���C�\@'T��E�/L	9����/�=H\��H+?�;z��J�-i��V$ �+s[�f�!a��8�\��Gqa'ײ�|ka�&&�b���# ����.ڇw�W�q,U��21���zz	��M�7<,</!��E.z�̊Fށ�[A�16a�6�%���������_�$�ߓ&�t<][�"���JPy���#H;��F�<9��f�����Z�k�~nZ�O�r�%2	C��A��?��cl`1ϴ0�G��kq�#f"0��XE���]i��K����y�؊�yGåi�$ڎ`�Ӿ����B��|EA�l2C��]Ǟ9o�a)�H�\���-0�G<����i݈|�p��<� 
1�����`+9�W��3���_̭lY\�~����dAk_1ƽ��l@������j�@��f�G�m>��J��퇷?�JW�u�6�]��.7���Q(��K�VW�����!��V~iD���Ȋ0@�����A�����b8G��������%�.sM�H�	 �Φ�ڞ~f���a�Q��l��o�bq�N/۵���@Lu��P��hX�L�����MVT������;0$�A`A<����d�6�^8��r�\���$_��!�4�=R)#�����L�Rh�m<�|褝|���D�w��.a���;;2W���՚NsX �M�9_6bf��2f��OtCf�QT��������x����w�I��fP� ����w-��Q�z�n7��)�&�s!P��t�	�(s<W8-��5�[!�tN�Ua�fmӽ9=(+���1;d�8zǿP<�a�,��F��t�>�@���H��'и��4I�I�E��/���2����"�����-t6�t�az�A��I� F�*���a�7�o����Q��zx툼�\�h*)��z�QSKe'��(��)s���.��'ل}E<?�5�Ү��X�ƙ�U�s���`y��b$K�Ǯ	�6�X��, �6�R3�K��Xӟ���`G�U�!����k=���&�>S#1���.r���a�ܛ�7����W!n�v�3���jUG@�0�8VF�]M���$��Q6��:m����[�a��	\�bJ�$�M���3�B��p��Q���D��t�;�Va�ګ:#����ŗjp*���5�g�hϐ��������2��fa�ߢ�h�b<�bJ��灸��֖�%7��v��_*ְek��C�u�\ ��NQ�j�(��ŧ��+%���'�RK��8WԾi�
f��pY��_`vsǏ�������M_��ۨ_�D}����0PhNh� �܃���?�w ^�E��5,s����4*�.��T�zȱ�e�3N���G��X����7�=�X{ �(4|q�-�\�ſϨ��Z������R��j�	�mC�@7�i�߆�q��xhf%S�{�|�#�zu���I���4)��	�j�l[q�֛�#������:"lp1�:�cl\s|��~s7����h���Qk#�ik��b�"��Ao�%Z �x���tLYk� �q9s>&�g��@׃�(6��C	��vK��32�?A�F��0��{J��*w��܏��5%��˷��C4�p��� �a�W��r��A��X���~,-�N�tB�,���Ʉz�J�p�xd9�&z䥙��-`�g6�0Q��	0����@��)��S�ꕮ�U����E�G�v4�,[u#�Z̴r����s�I�*��3�A�-�i���P����ӭ�J��Z���[髷�
����+3p�H��NW���0j�`�0�����y8+$0O_�Ҫ�Q	�8>��m t��=m�CX�f��� tWl���$@�*;��]��<��[�`>�����#���DW������Ƴ�i\� �S�C�k��8w s�$�̑G_�o�N�A��yn���y���lP��uT�<�J�w �Aim�\�1�t\�R��
����w�Z����~�n�W�l?��
�|�ڐ��? �c8兑��@h�M�/��P�Y�׋��1y�hV��w,���'.��?ĎԢ)3�W��DM��8���]Ѩ��Y�A
����ߓ��C|߭4�#{�j��s��F)�J)k���/Ow�  N\Z%NM�G�q�����R���\��X"�Uy��Q�Y�����K>�4X��\�������b�(%~+-�1���/�631 B�;�����f[&��������<=�|��g�E��^"0@�A]�hTuoQ�cQJ����~�Y�A�(ʜ��$;�����c4��b4�BNT�w ���D~J&��E�p�:T��K�6�^�
o[Ha�%�4&���(ë�h�<������@�+�zݨ	aK��Yt��(�fg	���K%�������򝉕d�#U�+��;�����ޘ�/�?����n�-������)df�����	K��A��4q�����
)�@��3Ť���o��'�L�cavfyq10�:Q�D��z���;�4UT+����w��3,7~�8�5�k,+�� ��>����,s�XZDh&LRYl��M����d��*&���DI�ī�ċ�z��=�!O�������V�9���}��kܱ��ͫR`��7�%/r/�Y�O������^���w(gy~���>��{x�0�+V&b��:Z���Q�K�[ S�����\������2��@U�u:3�ޑ6wL��B>�Hrm�fMd#�	fڵ����u�N-/��R��̴4޾{�����/ּǓ�4��[K��P�&e�H�A�L�V����5��gjv(e��P<l�V�P1�9S^�R(��1�BEa ]9�Y(�j�CP�ֽRrY;[w!]ȶL��>��^@�
��q�������(M�N~����}�y�'�IY�Β�9q΢~�a��F�N��YTNƂ"���W㶖�_��%ͱ���O��H�i��h3ZYT$�u��40�_��f�����z6r^	���:��������>YV��o�����:'O�cX$86ե����}m��tO��3��gz~��Nz�˙@���2�PZ��z�9�m�0A�|5�ĚjG���S�e�t��=�Z�2�kC"	;�l[��R�j�%q��aȭ��5]�ieCu+�ԃ��N��W��Mc�i�y�C��ԥKí�ΚԾ=!�r�9cV ����d�-��7��/¢��`��YĎs��4p[l����Z���h�Űe��
t�;�V��1��M�W̻kH�^nc�8�(<�~���2�k@�hֱ�{a�S�81�sPP-��)��%��\��Bu�I���k����`�,灊�J�{�K�O�qc'�,�MT7'pxkg�a`� "TJk��C���b(��yH�"FK5c#��y�����F��>D�'B�i�^��O�
������j�x~m�|�������CJm�5�U�0�̬n��5|Q<��P%91d��8d��F&�8�OF�}�Q�xt4j/v6�>T��k�B=���w���6����{G٫���}�BOkO����^�{%�z)OX��'b����3R;ۼAQnS�$m"�7S�9�����zWӝm�)��+E�L}��
��u�7�mt&#��O��a��v1��E�5�4�[>Q-K����A2�FjM&�sA�4zs1u|X��[9�������u�
�%l�>j�:��q|
	S^o~�� P%�u�W�縭�"��e��Nw�~R�pC�Ț��<�������+Z�5<r�VF*�"�ԉ=0i3x���[�K�~0��>Nޖs��!���
ޙ�(��N�l@�8�*4?�!j@@���^v�����ی&r�aqe>���iv��豢t��8��:B����/����9��@��
�s�4�/QN�},���&m!g��^� �me�?��۹�4�p�����zK��.�k�uՏӃpM��s�L*_MQ01h"��9LC��^/�3�ʘ�VT9\m^ �ҡ�/	���G�HL�L��]d��t��,�f���/����i�.��{*o�Y�N�l{�s�1(:
ty�č�G?�L�bT1�.ȇ(<j�4�'[V�WoR��C~���H��o
0:=��� �!��>���C�6�n�Y�tf>�i��@\�������%��m�c�d���~"�~���v��@������ҋГs���R�L�U�����CgK��{c���]e�����+�A	�@�`Q�?�P����G���}�Sۓg����_y���nU�0K1����j.��HL��Ĺ����^�A���>~BLZ�L�L+]���wK���͟��:��L��^h��ƹl���㇣6�'F�x9�7�-^���9����rz%;yVLSA���E���_�M�� ����l?���1i�(�؟����9��+�)E�����O���ۂ#>V�X�u%'� і��G�������`�c0!��˗�ꪫ��ܦ�$=���f�̐�ō0�?.�u���"�Hb���N`���ݪ����f���E��H��/���vv�w��jp��oZ�*�,,2��x�Z�})r����[-�h��Hb��F�V������2-��yc�a(��FO�=>�ۍv=�r��`��beE͗Rj�m[^��1qF�xz�Y�A�����$�?[?˴��F����j>#A��+�<�0���ܧP��g�8J$��Lq�Ui�����H������F{�<����A��EMoV�Ғ��A������j�֞'s�q$��I�6a��iU'Ce>M���z��*O+A\
��!5Nې%�N89}x��,�H�⛩��_����oo��,\��0ͣ��)�"*��!:��K¦���W5���j��H�l-�kO��
��%/�(���+{�i�$b�K��	F\��o��Ҽ3H�yJ%(�l����� �<����y��1����Y9\��e��3�T}G�R!z��P�4�i��pڟ��y�%zm�������]i��{6�0���N�X�ZŇ��:��BPe�kg�0��W�6r�I^}�qH�a#�Y>�eIH��iİx�����f?��F朂�x$��aY*!���v��9ں0x{JaRJ���[;���gߎ37*B>0��w�Ǭ��sQN�2�F�R5��Lqv��__w��d4�E�0��ĵ���uP����R֐>�ك�<ؼHHQ�GT�M~'(�G0h��ͰԼD��M���a�
ڱ�a��2Օ���»�S�<w���B�4G�X3)qXk����g}�yE���Z4¯.�?z��%!"���~/6��k;	\t�b��j����P$,�|E�7��b������˾�S;V����p�^8>
���n�1������{�-�D��`�=�[��[*
2�p��2ǥ�9礫 �|�k-b��"�րr2F]I 1�B�ʯwP�?՚�Dj�����,m�uL����72ӕ[O:`��t=�����nX�@�� ���i*O�9�s�c��ށv=▴�Ex�ayz���4���Y��-�sGr��d��<�IXGJQ:3;�h���#~;}[A��R7�V9����47��#�Q���F�+-�m+��ߩ*u�"�=8!�!�2)[�����!ķ�w�^���*t|��e_���G��s��J"[<~c��%��ޛ,p�,`N��<F��.�x���I�j����=���h�����l��<k�*n��E�pڏ��C�u�o\׸����4NC�s�D��Pb��P��++��V�L���椅�d��CzOa�I[t&{}Bs*�AU:��J��7f����	�6"g�J�\�IP��{�O�$�� D�_�~Pj�v��:�Oj���ϫ�a�4��uU2o�6-���y�!h-�:H�j��x6n�OJ�%��Լ͉8�������$Z��N��we���'%�ߵ+B&� Z��L�}:��hz�����a@Z}65�����&y���i�t2@"���ZM��X�.ɼ�W�~��,��*�J��%�;�	^�3[��?�gԔ�5��)f3���3q*��9=C@D�;VB$a��P0�|������b3�����X��&��wRU�CB�gu��=^v����Jb�0nwj�����Llq��G�E[v�1�:�0䙰vǚ�?�,�4:�|��G�m��k�l[�x�FoCAn����)[�[��wL9E�^��y�bF ��Px�Ce���q��j�x�$K�?&`��tʽD/���_Fu�.Z�ʞA�;��^AzY7�����M��˞.�^�b0@��ޕh����_��M_W`��p�4��Ԛ�fZ3]���I�����D�&x3n^��g�j`�?�S�����u���yC�����L�� v(�\�Ƈ����%Mu&�p��	q��Tj�*�-;|$�{ƬI%��ӷ��8�=����ۙ�[]�����D��O4��I�`z���81E=ۏ>����~[�k,j�s����y��f9AάH՜��P������s�S�#��I���:��Ǵ�#䓃I�F�����`����'��J�1�d�@�^e�h�%��0���`]�J����8�5��q����)�P�㫄u�Pz8�i����AB�����
���x��/,z�W�����>�5 �n~�|�E6yم��X�S~���s��{oF��o�(����R6�JmS[ѷz��-Bs�pMF^�D|+iG���{�~�`
Js֨w�*X��d���K�V�v�sÚfo�p���՞�7�-a]=��N�g�5������iY�v͕��2ܴ�wڰX��b���VMJ�l� Ԉ�w�\;�"͏�Q��?��7�V��u�]_���~}@&]�K�3!n�m�f�h�5���P�l@r���'���ʀS�Ը�>f��mV= ��y�5x����T��x���V�((�Q��f�|��"Vrgx�O˙�~��W�bu/�9��wvU؛�I�e\ՑP+Ă0�4�[\x�������D-ͱ�[J�9��Y�9�,���3�s>G��T�;�/m4N+�t#��j��i�ڹ��5}�MT�X��I�����汆G�_?�\2�L�U��c�����Kc����*��^s��ַ;�� ���t���_��)EΈ��}��_�Y(7(����H�o�:�u~�Zm������;n��\xfAk��z��P��6x�b|�u�mJ�#}�.���G%~�R�pS;9?���� F�>8���|��H������V�e������y�VI�����©P��ǁ�Yi�4:�eK�/=
`�)��E(�o$�s�k	�z@Q��q	��Q07�:� ����jX�|�Ĝ�"-|�<H�ӹ�ض�A%F�d�PF��ӷG;���@��/��W@���'j1�bx����v��?�y�Luĭm��I��WB��h&�I��_1�6��}V��n�ap��΁�N;����:Ԇ�Rn�
)mA%9�o���F�:�QD��:��@�?�>�(a��X�F _�OG�7�cXJ���|D�P�Vs� �Wl2*K'�0��γ#��Uu��^Pဉ�l��7�޺�?�Wc,d$Kn����P�H��ܘ~� ��9��C�� "e��j��c����QՌ���N�س����9��K�x��5qTgCiӽ���m��§�$��$�R�A6�
_N�P3'���RZ����/�d��Ƭ�|��Uk��V��
k1��/G�j�?��3��!��ӟ�{�;�k|��'D��ZVr'CD�ʂ) v�΄�mZS�`�'���@E��j]~=۠E�����3b���J�`���4�+l^��V��I^�LkN�c�H�Qk�Un���j��4@Ԯ���#U�(�p�@�����Z�t���7�p/��ԁ)�����������b�Ƅ~���]���-�IE�<Ta-G�!��{q�O<�)�����4�ݓ8�LDh��bH=��M	�ۿp��W�?��w��H��R�ƴʋ�?o�1h�y`�Y���հ��^����&��# pP0iS	?mT���֯��� V|�k<�����G=zAQ��G��"�����nͯ��BҕI��m��Q�9�4`�[�0����<���{]�Fh�N���o:�����58R6:�r��m\!�\�>H��ʖ
�Zʮ�)�ogfve�Ո�8/9��Sl��ܒ�l��T0O��"w�������������3%�͂:)Z�������qVn,�Wôv�8 �[��Qk�׽=$�tUK�GlpE�
W;C|�'��%�h�Ӛ ��NaW��}�+�;g��'��Y0\G+��#���8�{��@<t��:o�!��>� �'J�ƺ�� �f��RaE( ��~�X������{:�7_����h�n=d^��!����!�T-s�s�{/�Be����pR_ 
�.�S{��X*�`g*
�e��
'C&�T�'�"2/�����\z|�;z���)�"�ʃ���*�����ʧz'h��j��� ���Z�h���vހ����Y�}Ö8�I�U_y}�۸fN�r���Y ��a�rmYbr�'jV�B�$N�?�r)*�&���'�>i�2�B'ջ��{;���y�ƥf���E2����u��<k�z=xmp�\�2'�gȣ'K1t ����+�<�M�kRT��/P���Ap�p�gS�����a^_(�25U-g0?�6��>�Mո�2ҦHL,�s��"�mѝG;K$�%�)8�����9�(' }[֯Fu�.�`j������څ�le@��gW
v��N#��V�̌�~$N9X����	�9����(㢓�h��O�d���շ+(����$|�g(}@���3}�.����@�$����y��Оٽ�ތ`����a�[�!#�P/����h]�2깄	�c��݀���pP��(V�<l�2 ��Z�K�V�ʟ��M�i1Rcҕ�+i��25��aK��������ħ����7�~]��7)b{2��r`���f�[��q���|d�4�����A�,�x+k�՚���S�I�đ*��^G�7��g;d�2�/�ƨ@�]JE@*k�6���	�Ϻ���P�ЃI���@����j�$K��Cv��Z�䭡�X[��3��h		.�w�Jw�=|WI�D��-���(�ݓV��ڹ�?l�1;������g���41�łD��@�|[c�� tXO����1՛q�z2wD7�����P`�3{��$��P$/d��]4���6I@zwܜb�X�׋��T�_Q��򫉜��]$�{��W��BчMq@��Ɋ<���yh�B�����:�<+P�*λ�mؔ�fb6M�dL�iib��4�j��#����6qOOS$w�-U�[[ҵ ,+Hq���|��emp���%L�7Λ�|H�	^�p���'�����fKu�\�q:h��֣>�H�5n|L"�E1�]���%��~��Y5R�$�
�[sP� <'���	
Ϡ�1�Eh��(�d��Fԧ�Э�rҹ�>���#Y3�* �ʮ��]�����΅�j �������*+��X<}�Fg�Ӗ8���weVk�3�¯�،q�y4����.��/v3�,�?��Ӑ��Yـ�S�i��+\r����=0r)�oC��Wg���] ��«��`�{�{�δ�j������U����$פ2�^�[07�">�����Lp>��	�����g6�y4�?�c�ݰ�K�"�$^?f��_?}�+g��n��o�
�jv�jj��!5G����N!����*᪛U�x)8��J�~B��쯖FI�����Q�5��Ѐ���B�`d�)���&��#DK�^_�}�$�aЕ&z�z��&vJH�"W3"����"][ǈ�ʦ��~�Gv�6�������vc�K�V�7�^�*,I�&9��U�M7[=W�+'p�J�[T@Z��wg1HkY����&}���q�� û���-+7+)�HR��
�b�rr��Vg<�5v�(����N��&�Y�#P,7��箇4�N&7"����
4�>����-�L��&.�|q�@I�oQ�b��6:��0Y(��Yd vw��=	Z��
������;�T������[e�D���a�	E� �PO��*rt�J�6I'�~���Y���襚��D�>��/��wu��C-��'�����H��{��i{+��>���ň���S?�+�a�8����9D���*S�:"͔M�D�a(S�+�>o������]� "���'`���`�${�J
�K[��ha�Mh��9r�5�2؍4Ք�f��C���f�MK�!��Dx�,=Eg�,5%������H����H��H� 1���`46�C��!�r����/�x!��4�8�Rs��E��.\=��'X�M?,0M�&�MA���ѿu�v���u�5��]iD��FOv�l�B�G3A�z2_D+�?���V��s�N�O/,�D��L�y�6p~}���Q�EȠ�M��1�G�����%G.�HL����C����?�F�-�n	8�ͽ��~ߤC_�2���c��X���(La��ɲ�+��JC����������Rrx\Ԁ�`���r>q}��Ã�9�������.Cp�+��`7�!4x3U��Tr�䓯L���ri��uu��m<_����z��吝7��+:�(�
�s^5�CXJhr�l��:��yМA~�*/��m�x��B|�R'�˷���
lƉ��+T�߱�}�W���IϮ}Ag� 1T;��m�+����?D�?r�V����'���LP�!M ^8���1~��n=9�z�,j�s$1�i���#
�O��.|��}$ 3Ǡ@�,�n�j(���H���N5��L��&��F��������
t��ɞ��Q�攐�7�S�z�
�T�7q=�}������Fv�ne��!N��e.r��.'��]��Ht@�o��jC�^e䋨א��[h+K�@����@�z�D)D�5�=y��\r���2��Zs��*R�(�Մv_-���"�7ѯQЈ`s�h�Т{�ˍ/�9��E����8��q�˱�tb3�9��k��'������!���԰���O���`�m`��S�ϟ���F��?r?ҝ{G� 2"��ڷ1�����	�3jux(%���qdn� �,�pIj�+$�l���ǿ�C\���̙d��{oj�Ӯ�*�k���Rg�\�[؀3w�����}��3iW����^�#y	�����5q�v�y��{Y��~D��T���B��v�u	Iv*و6:y}sdJ �5W (}�JM�ߏo�w���V�.������
�G,k�9yQ�/��;�4�#�(T�0�;��+s3M����G`9�m�������.2�W��
�ԛ���7��7�0��]ʣXT�PQ��Ň���]�K��<u��U#�V��A�&��� P�S��ID�)��V�ߌMW��(6�uy�{v�؇~Y rb��U������8�#��3���$Ug[��1�r�rq�F����J�B�y}e��@$2SP�k7�D�3��9Y����w���q?���2���b���L��9uI|���Rךu���}�8@.n��xy5ި��U�0m0����47���F��K]39��ǳt�e�;�"6�_%R-�!=ԥ����CX��c�M���/
��}u1�7��4Y����w( N#u�N�Xq���&(�?#J����Ȯ�N
�I�����_���KR��诉�tH8��R� �;n��4��?�Q)٨��@�]�)��>f��YALH��j�;�(`KJn5iK��p��}
)"�ƽ�,.-������o2W" �A`)j�^�x��tO<�o;X���m�G6z�nd�1��lfE���r7�,��ڃ{3�B�E/� s������
v�����x��Пi�F��Y��׿�y�8����i�ː8c�'�R�j����HJ /�K�C���x�X�f�f�)�h��+C�Mcj,��V	���8�����o�.�s�>�i��uI}��F�/�rSiA(���ﯮ2����=��������I�1(��%P0�����}Tg���Ԍ1�PeR�ի�Q�s۪���9xجG�S�Bdz�B�m�Q�l�ي]A����y
�L¹��yV���a���n�2��Lԗ*b���㴨�H%���k�1;�/�[��Q�=u��*�K��l���Fi)_�֒�z�u�H��\���b'�6H+��i>�`��n�o�&ԡD���g���o��/gn���\��dN��ֻ�l�FtS���n���+�q�얘��u�"vێ �}�1�dJݴ/�X�W�@������L-�x�D3�r��<�T	Mg�DLy1<�(�l�[H�'�LA��]'l�ݴF^�Zއj���ho�xY��t�'�A��q����a:78�^N^o�Tݝ���7'\kwK ���7�y���z X]�(�/	�d��FTi�����22�F�+0���iizӖ���`6�q��zcl�D����q1�f�|F�Ŵ�M#(�-K4�x �����V 2�F��t���P��~܎��
�����m�X1Y��@EL ;�-�L�j�����Xrou�l��p�x�)�Z]P�@Ql~��1��u��?�&P+F����3��3o��%;U �Zi�
�~i�x�L�D����-_��S��!��Z�W�zę�f��G�z���c�Fڠ�;$�����D�#�m���p�������QޅM<���K����(���?�����+Y:�(�!�P��7�B9�����������:i�zv�Z1��H,�e�B¿�
1f��*P�#�D`%�UCO]ʖ&\���3>a:2���g���	R�4������ݧ�+ɪ=_�p�~��f5Wym6 ����?�$�dK�>K��xE;Z�+�ᠾ�J���1/w�w҈�YL�:�[���LE/ȌP�:��~�\}���`]o���*�Zhм�}���V}ڍ=��qs�'�;�(��4ԺH�`�76��H��B� ��̡=(���P��?�P$y��3�z}W�:�����UL�\r���*tA��\�\,j�kϬ� �V>�x�D>׾�H`�Q��_)��uH�ʁ��ؖC�7RԒ���|L1ܯ���Xp�����
&J(��#�N�����~��2��ܥ�^���5����'"T���44�qWTyA̕�g�toa���DՙI���H��e�ȰxH�ak$B���3�u���%�%a`W����@I�Q�i�9�x40h����3s}h����[�Rw�W�.�W NՂK3ݺ��7��=�i��(%�]W��8�}逛�,do��탹f��Y����_٥V@��@��Wp8�����(L%��=j0�tߐ5z���Y�JN�I��U��r���x������t� K�pR0l\�=22� L���vZ`i�+����Z��	�6O��Cr�Z��/�+PU�WdS~i�\�F�Y�>�8,U^H~����*�]\΅��[�@+�Z��=n�w2&���;��NBf�L�fy�D�N�r�t��O��$~NtÉ0p�|a�9bւ��x�=6ѵѓ� ��Ƭu���2$�I��d2l��-P�$�H�,tVi���\:����:���m j.(+`z�?*H2�5]apr��퉏c�)|�g�G|��X��6�����bcm����;5a�˝� �Q&6ׁ�1��� N�@3=������O��F6�z�s|Y�]&Z�֫�2���.&>(�2tkğm+�1g'͚5N�!%���
H��њ�̺<ωǍX��� ^p�Tt�b_eT���/�?��M��L�s3Y[���0ɜ�+�Dm�V)>R�	LR���1=A:9��E�I�.�z�H��`�[Kj�.@�V ���ʵ+�������m+��|����ve,�"!��?w�?�K9W'��OF�X��2tv�k�H),U������5��X1�l�/�\ElYV~B��胗U��F�Rdu*���V+F��j
�������^Z����
e 5F�kÖPL�?��KymJ� ����ay]�et� �p�=v޵��C(+6�j,�@���g�!Bp��H��s��&N�҉P��v�w��Z��o|�/%��\q�:���DM����˴��!�-����@:UX�0~�O/7NKL��pٱ�39�S%\O��8���P�:^M=�2�8_3�`�X�z�Aհb���"��-��.�?�r\�r��ۇxgy7Imv~+g�~�,�z-#HR 5�J1��/L��U�#{�I:p���z�歰���
Q��3���I
v�b���ݻXI��J\\�����c���Pak��x����;?-O���lkS,��*Um�|����V���������k��?q���:4��B���Ml��Ϙ�~[	�`/5�;��N �o�ԑs$^^�Z<����Rz�.tJ����+�.��u�^zI��p�+8$���j��^ʍHX� �Pf�x۰xn������+�(�~K.]5&��Z�V�5<�f���Oi�UENa��?�� &�Ύ���G*��{�.�	ݏ�� H�םD��*�	W۴y�>fT�ld��&��dd)Bˏ�ŀ]f3�98�"�(b�/AQ�ϓ��i�9��e���V�)،/<�0����词�6��ӻK���p�1�tŸ#�qtO�C'?qY�Y���M��d.�;��MR}�xϊ!r����^o"�]ą������	��|?��ַ�u�K���|L 톀w�1�O�`0�:Z��<�ya<�{D�P��V:_��9E2��9�5���Lǯh�r?���7N!i������F%�4��֢�ҕ^R�̝�������5HevI}M���mD��^"Δ4PS;!u8w6�%�`��Ud��1��ɧ��ڬ<�4T�ś�Q\ХYӟ��pd`r
��>��En>E̗��*��
�
��}�jux|q*Ű{Y�mE�`ZU����}59n��P ����s���t�e��(3�ά��A{��#���� TSnG~���0f=w�hb�|p4�I�"Iׯ^��v��϶m��6u��7nT���	 h�	Y�?����|:��ťY~��abM(�GBV秫|P��)1�S ���-6���%h�Z,>P�V�G��l�Nda�{��Z�)�צ�M�bM[�(��ѫ�nT�K�.sY�<�:jm0�2j]?ޛ�m�G�|��`{�N�0"R����=��4��Κ�Il&H1<���[��"���ƒ��]i}K����ao8f�\������c3Qi������C��,�Нv~ퟖ�"�I1��	����9ܭ�@��</���S_�fQ%����x����p���,mo�����P�7�"=KR�>s0�����N
�+��R�)�J�L�n�S/r�=��>��	��G�Mln�0PQL��Ϳ~�&��`�X���[>�63���̇���`2�4H~j��Mb���-	t�q��jX���p��+ep�����%������{}>Q�ВRM�Pؠ������%��+O��r�홠�~.m�����}D��Rz�j�g�ߨ�?�d���7��x��X�V2���onj�oĠ��Z�ޠQ�ƛ� �u۳�+G#��2��%� ����,(�*�9��T@��b�.mFp��bp�އW�]	���	�Eim�Mt��� a���C<�2�3S��G+^ٖ-]�m����ʫ����0B�u�}<�׸�u�}�	�Qi���^0x��/�����9�����z��VR������i
J���ݎr� NQ��u��̣�}���Uc ��>�?\Y����87mļX��Ά��s���1�4�Up�[,/'v�1��л2O��1 $/��� ���a_B�-j�ޓ4S��0��	������2(�\ϵ��o�9������#��ѵD��9՗�ǐ�zQ�V�����d�}��lIH\9��%�!�]ЉvL�@�Ԟ��S�h	�T��s���[���_�&Ox�T7>���F
����!�����=�|��L�L8��k�db�M<:Wܯ���me�g$A|���8/i�#����T�m|�9��r)S�¡�� RP� ��w5ASQ��Y�=2�o3�m��({��q�	28_!�����m���Z�$eV���K� Ҷژ�̽��s�n�_�8
����j��r�	�`��u$��&6�-�H,{��V�����~r~��b}l��<7G��_��
�9�Լ�1�Q5��o�����Tk$\tr���f6�ܦ��Qj���zv����spau.[*|Q��W&%�L����C��O�W}�J��7.�,.���.WuDP�|Ki>�$�B8�^�L2R��\��b�4�����yЛʘS�� ���1�?�U�!oj�bɏ�ZkBl̡���0��KKV�[�� �i��J�&Sp��I���z6�T�ѿ�*����pؓr�=N.������S��>�֋=�Ȼ}����^&v3u���U�S����!9�plA0�z�6���J��In�E��|j�ah�9�W��-�e���2��r�߫�����Т&xz��f	*ew�+壥?�N�o�wUqV�aR�5�'�IY���zN������(�D��R"N�۔�r5�k�[������s���77��u��Ll�����-�a��&D3	� 1��'UG7�ж��ҙ�˷~��֋�xl]�vm��e�#��s�>sF���=��J����7]�`k��QUY�2`��W�_�Wo<8+G_�Hv[b[�U�D�Շi�Pyc���_J�x4�ؖ`2v�I�H@K8�!B���_Xfkv�.��zl�tm������oi4Z��<���@��z��5�,���=_���aގ����R��/���Ԋ�r$�C�� lp
�\��l��Mb�~��iϹ4�� }�����A��F��s��]�J�)�^�?��,σ8	�q:�_9�s�ް\1��ב�����1�����8�Ά����y?圉`=���X*�l����OK�Y�f��箵6�!�#��;�r���9��>�p�K4��lũD�n$�R��Z�����x�fKc����DTvh�B�_�TѼx���[��Drؚ>b���E����}�#���N�P�n������G�π�DQub!;sf��إ������K!�@k������#��+ܑ� ��pZ�f��U�Z��^�B�p������%f*�>��w{s��'F"Cg�qư��3���o��Q|S'ahb�B��N�������l^�ݳ�<�i�ԭ�7�i���
�bŖ15{��5\�J&����������l��H:?[s���숺t�������c[wx�~� %"�Ca6L0Yt��l�P�K��[���y�!��$ZB�:�6������bmmɐ*���'�Y�ǿ�;�D����d������[|?���G[a]��ײ9Hg��'@���b�R�J�`��nx�H�A����ھE!��(P#�ܒ��U�{[zEOF<��ǞGI���Rh��~'P<��[���:�5��K��\͜2�O��(	�q�vW�I�IE� <�JQ"~S�6,,0�7�&�5�Zһ���~��,s��Ӯ ����OH�y.�oUZ~��m���Y���C`u�$���5uǡ闛� P~�/��ܵ�B�?���/U���T/�����ɷl_@�zG�$?래�Vm�-�[�h��yAm�Df�8S� e��g�M�T�iHp�Ȗ ����BeZ�(��;Q��eo�ʩ��hR���Q�,�
!��UD�N��p$�hu���[�)�ߦ5�'�G�6��ՠR�k��3��o�Ь��t0��)I�O`m�Fg�����[o.���~�V�xg�F���de	���<]�$��Xn�!�l&���S�j�b�?�RTlGD�d޽���#���0�|�3�0�y�k��������#"��X��OČ�}�vl��jL�T[ ��.[/V��U�����m�n�b#\+��9J9����1Qa���ז�gh�ah�ह�r%��盈�b���,��}q�j{m
pA Xa��M.��̈́\������_L�P��h��]���7�O&Q,Ig�3��PC��P���+ȴ5����g4�29�3zk���|�#���2�����2�K/�f	��/\ׅ�E_���4Pl n�R���-(�V)��!hv�׬�$�v��$�K�d�}���WvuŸr�n���a*ҕ��|s�Н�>��ֆ2PZ`dDja�e�\'2{�[�h��f��Z���4�T'o͆�ˀgIE�O��E\�@�Ugb�#���p�Fs�i?�Ǆ���	�F?/�K�S�w�)[r��$*�:ʓ�z�����z��W�U\���#���b������o:�jt��j�*:a2u�
{Ċ�$|R�{�7�J��"��Ǿ����T���{?cJ��7|@qs]|�J���6ƃY6Ǆ�cf�	���b���[R�A�酟����H_�iLg���Vןyn���+��s�.�8�*,G�a�o��/�<	:C�a��`�A��Ta�AHn�΍����M�<�$���)�W|���9�k��6=��M�[����FW�UQ���q���#�K����6� f!�뀂�0ʗ�Aê��b]�����+���mx��p0�����z��m��\�!��)��<��/�6���%�e�	�g�Z�
�sHڊsk5s˧��<Q��P����k�{-NqCs^'��{�9��9��k�9`�4����K(�T��·���_I�&JW�_Ԅ��h��� ]j� #=�q����C��*(��S����=8n��k!�+Vŀ=-�P�v_�/5ف#������9��tL��j7o17ۗ�cZ�SK�pFkB&�!�ILhtf�iO��˕��ݡe�G{I99Nz?Q�����7��L��	]����K��Mt�"�)
�~B8t�Ee���+�2����4_�����^,Wq��=W��T{�$!���Rs������u�T�}��~�:e��=+9
%!7�������0��㰻����*!��4���4ֻ�+��m�r���#m-�A�16���8��ƻ����.r�	:�n]`ĸM�G���?� z��`/N`\d`��cx�ס0�:7�VU��E_y!Ol�A���_��gf*o ��%R����h	�`�a�K4٠[d�|�pk��7HN��`����_�,�W3)p�l���(C�����ü��lbo��C��&GR�a�*��R��AG�i���!Pa���DM�%�\�����G=-ַ��^`�B����G���Z�0��[)C?Y�_��{M�VoD���sE��3��Ed�� ����w��L݆�H��~���:�����u�ڋ�Ro��:['����zh��*�����t��_	�A<�����A�Ԫ��54qF`J1���(��(K��`�J�<[p���7�W�g-?����xu8a��')�0?�I�
rB*��&�鋧M�_[b!�&��&��jL<z$	)͕$Ǚ�x�HJ��WL�ՕW�E��ƺ}�Zs�1w���ZK�����T�����"�Ie?(�E��?�s��.|6|��3��ͯ��{)�g z��y��",�ZBP��e���`4�a�7b Nq��>���W��(��\)�"�b���]�B}
����ԁ��������C���ʬ������Y�;p�iJ��i�ŷ)��.�W���E�Y˺?�Z��P�+ȝ�t^�,�"�����I����І�V(�8_�kT��z��⩉�#,��=��}@��\�s���h$Ϛ�_RN��a'�O�'�k��<}��)��C�h�w�@~#.5�:��+.Q�w�8���7������xO/�RC�[�����:e#�>� 9�ȅT�uO��ӡ�+�/%�h^՝?�}e|�ّ.�Z�7���d����.��z��&~�?~Zz�X�;�#h���/L��h�`�"����Փ�4��o�4H�u��n�d)�d�h��Pg��k�N+�`{b��:
)�M��Z��p˓ �Ye%�'����N#�x��L���K�Gp�U~9�~�:�A^�$ӲZ�&6#�~hb[F?�����?'�i��$:��
�t��C�9Z(b����G�T2$pr���A{v��2G�o��{/��u>�Jυ"`<�t�������u��F,�=�A����&	���C��V�2��?ا��Y��B� �`$��x�L�(���q��ޏ�cŘ��o�#�>(�ry�FsMa2V�=��w8,�\S��_n�5Om�9�1L�����4��S�q�M�/Pu���S.�E�,�4>C��c�D}D�gI������1iS2J屽v�F��>i�p2j���=Nf+�P�l
^�;]�|E<D�QA:	i ^�h��wM%:�O�f�Q���Ril�g�+�ɸ�!���6��&_�5��V�a��!�.��/��A�
��7S)D"\�z���t�����G&V�xBw�o�7��X��|5i���C�>�G⚔B9A�\I3y "N=�X�G��1f��,j�O�v̰Z������{�n�
�8A�V��6��w�.�&u�0Ax�F�$f����ֻW*ַ@�_�?r-U|Q��
	Q_|H������Ք��&��2~x/�w����J�+��տ������c��@�cN
�3�T����)��}Qa�O����y����� MoT�+�2^��Wf�Z����o��g� �5�6����'9�]�6�trG�fHhq��rA�]��j���L���	��W$ip̳�������J"+�$xf<],D�fx-�GP+g��z�����������@�E͚=k�%�o��/]>6͊pꣿ��R�.u[��YP�K�0��e��yJy%l�v�,͑��΁�b`��8s7^��Z3<׆��(pn[��ǰ��#(����$c�=K���.�I?5�oاs�z|�\h4Kq�lCa�#e
�m`$Bx�N!�J&�Q�0ȉ��@�ժ��mM�X<}�� ����䂑i������#�4���̆�4E����r�T
A�$��C�YN����?�0�62�x�w=�Ĵ9�� U$B���򷪿k�a�=��`��GyhyU�����q�|��8]�8��H�	�N��0�W�f;w���XA������N��
�64:ڳ�O�%e��%|�8��ZD�-r���L_Vv�@d����<%,�~��	-f"�8I#ew�p��y���I���ma�׉�6�h�p #B\�j�bR��O1��7Si�Y���h���w��v1͸��Z�P��V�yC&��	�d�j>�4�`m���q���j������yۖ0��ٺ�N�uo��h�s%�+˃���ߡ���*S�]й����I� �<.K�}*Q������>�����pn��?W_��{hf���=�u8��J/%I��i3��%��8���sH�I��K�yL�hK�P�ȸמ����;,���`��gʺa?`gUP�q���O�<�k?��1X���vR�o5f'��p`xA����b� ��o�`ö�	����$R��x؝�Yi���a�-�,^��;3Q�=��kA�J�2�{�%�˖�fm�n>+�J���\KP�@��BY�"��\xTI�G���<sWf�m��7�����R����f��ZX�S⚱[j��1W���Fs���I�B�6���h�t@s����|��$y���~E�6=��R���f� @�����ʻ�L��ˠ�c��K:�ξ�q��~��P(�L(��e��F,M�LM���c�Z��_!f�d��	U+��e��)��E<poO�/+h)Έ�>���A��2UF`PC�Z6��6y[�­~�d�e���z��M�=f�z�H����[:�^ũX�(	�=�������R$��ϱ���Bw��#��)�c�ja$k������\d�c�m�����wr�O�?	 y(N�	9� �> ��B�A�Ȗ�������Y��']�[S#�v�1L-E ��J�
�0G���.���a��%�ƚ��u����~5E6-�w�x����Q�SAt���B|��h����������=���J�x�λ�L���9l�>��<���,g��#l�	��&���T)�m8��F	�q����Ale���g�}J�� � ��| ��_�����ĭ��n�jÖ/� �DT��2cL�)�5�tj�5`'��O:��D�1kkp��	��2��H!A`��A�'���\{ꉞ�\2ݠx����N�ǲ�-�_�J'S-�^Q�H�-S�8��䇊�j�5z��Q~Z��_e�ƥ����f���5�q�Ǜ��ю�ۭ{i5�D>&P1��g��TE�c������ɵ��ޚ���^	g�sq�P�9!�J�`�J��Uف��\���KbS�Ҡ�%�eԇ�N,N'FX��I�!ck����GQx�Uޠ��2}���fy��Q������HL�N�D%RM�f��Ka�婑{��t\M����N~}��Y�!r�P �.�ko�F��zB�cz�o]9D�l�ՙ-�L��F�����t��5�z�L�{�k��ǀ��}��am�rp��z��	��Eq�x3�Q��#bR�[��y�6-��OA��;��|��O-���)�t����NJ��#��ͳ=�C���.7�d����q|�cy*Q�D4��WZÍ�v�E�I�[r)En�Ӿ]��B^3��b/��Ӑ�H�
��׫λ���4� H�B^+f�ס|�"4���XI���������d������c�i�����4��od�� J���sf���STDe������ P�Ƣ�ZjӁ��	¿��RpX)\8����	�v�U��Fw.r��'�qDU����am>��!��{a�Ө�irF;�|O~íH:�auS�M8cÄC��&k��Tb�r����>q�'��Сc��h	v��'�;hܛ#����Į�`��Y��]p��e~o�<���D�Ϲӽ7W9��h�1�JL5��������z��Y�^廹��w�M���d���YL��aFYe2�b�p��^)M�ٽ&vt)���#�T�j�n�����(u�&�:'���+0���w�@F���O�"��4�c�'�}aR�&'����:,���`ڴ�h��4�Y��A�7�>t��i�&����h{�$�Ԕq+���	�Ū�H�|���ڕB�>/pP>�M���r\���t9ho���Y���lf/& ����0ú�=)��~�~���o���ܹ�S��s���ߚ��;t/�0W�5�TbU�&S+�.�1R��ƨ������&�Z�s�As%��B�V#���T��S(s�����$�v������I�����\��d�� 2�/�v��Y�yN��eƹRX���^v��td迦�@��Z)P�=��x�\��q�׫��DӜ%���bY�٣��^(�0F��1�\z�4�J��3ڿ�z[��d�@5�Ib�btRVm��V����s���#����'))`�{0�0���9�璲����1���s�)�'��\��#�A�緭IFJ��i׮���7oW����)l��J��Fz{�����`�:n�����O8R$eV�'a�c��:-�|ql%k{��Go�����I�<�@9N^v&�d�lEݜ�N�������0	=ӆ�XCE�	4��ʯ��rԂ��g��:'q.6Z�} ��I�8��q0GY`zH��7���mſ�k����X����e���¸�t4�%�:c99d���/�C�M��FVF0�c(%��{��y��+/����}�G4��B�U;Q.C�3Ɣw���/��e��0Pt�U�]#v,�L�.��w�Z,_u�Z���!jz�:�,S���}k�1�Ϯ#����'�r`�6��#��/uֽ3���4�5��B���GH �R5#f�O;� ����U�9�2]g��!�����CKQ&��p�!r��R4y�ߏ�{o��	K��"w�\�dP+j]dc���̈���L>��t'��I�����淙�U𳸬��{����/��=r��^ɬֶy|N.��)</�pD�h �\��E�3�_�����ɣ�2�td�a#�˼(����O�������lJw��@��/Y-W"�����_�x\�7�s��N�_ABIl׎�;o���h�[�83@l��_����[A7l#C�L�i2c��݄��o5��o�g�oOZ��Z\vR��">��_R������(�i��q��A�g����xa<q�����C�?��~ӭ��]�(���1������/� #��{?�:k������������M��̊�M�E��2�V:���x5�^��7���(�w�cd�+��8�K�'�ѐ$l�	��vX���¨Z~�U�	����-t��<�,�X������_�%���j��B��Ȥ�}��š�(������
�����l3�tr����A��K�v>�<�8�\31�N�R��#�%�Ɛ6��Q,�>��X����2�9��MU-�i�7a`�w�$l0�4iv6��c�,�0|6���{�L+1�3E)��T). �ȖT�4p��Jo� �P��;$��M�G��"�ċM|��jU���L��B�����_�i�|ij��cw�X�m]���{�υ��/8��O�Q� �H���
����"��<�j�85E�E"Je>�m�
�+���5H�2�S���b����./��m�`]R�	h1��c��^ʱ�-��V�ڡ;�S��E��Qʚ
ݨ�/�R��(�Sl  ��ح
A��1��������T|�A������VX�ԞojC˅���㌄M������M�/�s�n<��	-�H�0�#޴���N<� נ�~J�fV�ʡ�[f���khT��s�V��G�����-�:�/p��:��r+�JF�TBвP?�鯩�����^�[)	����4ǟ�m7��Z���*)�7���>�����p͈��l�p�t�A�<~IE��Mj<��)����*>��Mےj�D5�,̴�oC�7u�fΉ�e�1T��"�P�4P�f
���Ͻ}�Z ��Qџ�a�]��������-�:ww�	:⼃*�N����-�+J6���pN���R�,�����]���Y��9�Bd���B��@��\�3#�sf��2��������1߳<��OTIo���.�h��ns'|��.)�����*�2�'(2R�lun�K,��!\*|R���G�q�;�rTD&`L5��^�a�q��Se�c�����c�+��U��3�.}��W��(����0�;�KH�<4��7Bo�hZD�&A�1���3���O~\��,�������hh�krW=2.���]�2g�QI����#p��&oe�Mm��(v�^�.�Os�撱P��{�l�Gr8�����%D*ٮ��f��+�I������k���~q;҂o��A��M>I�����L}vBh ��Ji��2�#��-n�MWK�5�j:� \�ȟR�
����&0�1� Q#���V��Qϙ���ټ�[���(���!�`Ņ�/��ǝ��	�`�յ�,����,j�{x�(�3~��b�j����RL�VR�<ح��;|]>�;!pH'��c���O�DZ-:^{(z}l�[�n�O�L0*iK�=��s�ȟ�E�dHc�l��fW5�l���0� &��x/1dO�݈���7���Zc ��%ߥ�����3�M�����i�(�_�?�i� ��,ᩳ�i�Y6o�����Xy����h�M��p�M(��C���M�ƅMQ��=�W?�jR���l���$}�Q[�Q_�!O��l�Z��~��[�k��m�l�+& v4�Y'᧠�7�}�������2`�����U	G�@�0���<B�Bcrior�!�}��6�4g�*[M_���y�})5����5��_ɨTմ�ɠ.�?b\$/��o���R�h�r�ȃ�
g�1�ǁ4�I,К��i�<��ղ��VO�,��-�!�z��n��ƥt@��VO�����u@�l�2E,����>�K����
����Z�PC�+[��6
K�XW~�����$�{U��ɒ+� V���������<g27�Y4[..d�	7��tt�fa��l�E_\;�j���]�e*�G�ي�� �dJOo�`0�7gW*��O����{#��>�@3$�����"�U|u M�u�f �c�cb�:��&�n���?��i��ac]$E��ھ���oLU�;�����"(��
mS��ZS�A�ͤ��g`d�f؇Qǐoݘ��J�>�򣯻@�f~���ků�ߞ��k���f,��W8z_�����ٙ)Q�E�)���<fTV*%��e��V���G��?��8��9�m�z������X�m���j<�=wff4�i��/+M�d�7:�dxR]&��
�X�Ƨd�I�
$�w��^����)��\VK)f��A��yt�0�O��Z����m�U*���C���[w��o���0'Sϧ�ʵY�K�y�V5�{��N�Hveҥ�;��^��F��?��,	4�r&�_� Χ�����}�M��S�EE����vZ�?�4o��!0D�$R_A�"h����i2tl��H�)�ov�΍�s�L��av�(kNU�E^��j���d���[�'Q	զ&���[��7�c�A��ኧ�Lj�F3Q��ȶ���g�VgS����P�2t3�æEX��]=GeL�`>*E�y$�/8kj~�7��"���dY����aX�n����(M��2�D�B�E�^�P�y�m˰�=Jm��+*�m��[��u�u�b�r�.Hs͉=����Z���'�X-1M��γsm�u����� �j(T��=ݍ���U�D��L��G(��ϟ}�:�\�C�>Ƃ��{\Z4��R��~�
�jI}'�\��=0�s�+��q��Aэ�OmQ)�p��?���w�Q�v�����Mv���A�J/C��_X0͎]�Y�S�0SS]u�*����B&�9\XH�`X�[�d�;�u���7Q��q�8�Y����,#j�ˑX��J�8���&nS��8D�jc���E��^�� {.ٳ���q�?��΍��C�Ԅ��h���O�<�H����}��s���A.D����,� �aH���+��	>˸��J�Q�U�J־�
�C��F�����G�>�w�=
Ր�k��h�z`�"u��d���n�/N��sRbs��D��)�5ɓ�=}gd�py�ݦ��$?��>�~̽�1V��xq��+�UJ�7�I�ѳW5z���횧�|�N�}����D�q�fp==M؛�>H�Ž�U������y%.7CJ�7�g�=����d`V=�n����tgm�'�P�-�M�CLGq��yj=�̤g�����1 ���G�� ^��4�8g�Hs�*=�ybG��j�#����ʧ�αƒ�w�[2�S�v>K����x���$���-���"+*X�<��)|W��ɦ�\��L,E��4��y}����.�dB�sU]'�k~�}n׉�^�$;�5[�g48�aabU�e��`_M��T��E�|�L��v/��"Cy��x����S������]��N�J�3�%I�N6�s|_�W�4�~8k�XQ�+[���u���o]7�_��o׫�Ho��z��[��Do΢����!a������x��LL�YEJ�-3�<J* k��j��=tD�{]wP�"�q��2���mK�'��O��!y\��-<�D!9�.$*�-�ڤ�{���Z�dV
My��x�,jP����[�����\=���-|��ɋq� '�m:?��e?NE�t�B9v��o\ޛZ�j�}�L/*�]�|�*�+[Cg�L�IcG��r�O��~8V��w�@)�����ci�B��_ѣ p|�V�����^�5�rÀtƁ9������A5D@�.Gi�۵�E7�B�.�=���s��m����"v�*�%}-d~�����30���Վl�{�-�*	�U�O%�����}�p/����+,��bb'wG�i����L�hL���>�A��s����^�#Rd�?�u��ԩu�_k�^w\�oID؇����W���܃�q�P	g�t��sP�mo󖱠eB �Bu�)NAk|9�� �ڻP��q �J4���s�����8�U>�_������օ�����&�%������{�v�9m������~���W[�?z�ɬux���.���'��7��������a5%��so�����S3���4N�;;�b3ʷu�v����h����f[��u����,T0YC�ٍ���4�كZp#8����e�!�os�����z;��LA=f�%�����]�(J��4]���:4�"*��r�Ow���T�AtG�]�荧�
5�1PQ醫kO4��O��T�~����e�_���!k�&bu^��p�}�%�ֆ��5�	ϙ�-��-A1�ч�A���A^'c9��C+��e��� p�j�.R� ,����=�� �ɡ_�ڕ��q�r�C�r,v��o���2�)X�|s<�b/�a����рr��d�:UkF��#�闱��P���fC�Eڷ\��vP�\ִ�\s��>�b��� �<y^9�W)P��x�`9P�3>��G&���8�b����:<cb�5&)�ʍ(Y�0/Z�l*&lS�N����y�x��8��Ү%W_�w��W�N/|?����9�x����OWЌ�5��@��Z^��)�|���i�R�G���8qD���F�vc�ѐM������|�W�Ps���kXT�-�p���<�5z�hT:���ݠh��L���V<�~�b:EG�� ��L���`��]�B:H�ҋ�Z�V�U	k�0Rʦ>���av�$�������R4��!G�<Σ+h�,��e�X&[���a��GB���I��'@\C�֋�i4�L��֐�:�M����ʿ���B��K@��;�L�|/[�.e�,cH4	�O�~��qU_��	3Ik�0Һ�o1Qv�0�-�Xx��n�P5N�l�8�1���ג�d,�4ŦM��ܧ���������f�k�x�J�����s=d�a�C��g�M�;���Sj؞�ܪ���k��z
��x�8#��5�&�<G��l�����s#!��5����؁gC�n8���e�kp�
�7����u/�Si!Kׇt�MnsrU��@���#�q&^�5�h�`?�{;�r��|���gc�F��H�����jV����V�QF�����=�npz�l��>�,�bg���1��)�{����
�� �)��]�i�-��9���$?����$�Շ{w�=G�����ƳC��gs���^ם�ZP��G~��ڊ������65�0dN�r���+���:'	�yn\�H����H�;��ȭ���{�$А!~$�J�bMK�0�M:@}F�PoGR��>�`K.��K(�Wt���.���z"�ʧ)�X�2{}*��K�>T���A�2�I���y������=*���DX~3��l/ͼ��8'}��� s��K; m���'�Pm>7%ҁ$�y40 (��B�Y�B��_�Ow7�ߪ�:��U�X����N��&����ƴ0*��O��3V��[�����{�;����;��'>��e������"�Y�[d\�8Z���0Ąd��b�YL"��9�����?^��nƸ, �t������x=*�'w�c��
�F�R@�sx��{G5DϽ~�DJ�}�=�;ᖼ�*��F]��@�@3,�tӶ�~% Ì��x^(�SM����J�:�B�9�Ez�a�oOlU���]���e��:+b���,%���D�l~8f�=��E�
��(\7��3�j&a�|$��)�4>B�8>�3���o�:��H�]S�)İ�Rl�_���o��� �fO�=�lJ$Q�w�	ȇ4��|�L�y����"j�1*��'�&�5��h.`�z����؉�͌C�{�YV*�h�.Ce��N�[3��(wW�Tޮ��$��M9S��t �>U]��JY�ʔ���y���K����{���Lw4aG9�*�>2x]�����
����b,T�y^R�~/D"��C�*jx��G^h�����Jkx�V��Z%�k�ܵ��>^�����-Q6 ���Wv���e�m�������@�QM`�h�?���06o�U���� !6��+k�Ԕ�K��+J�? �����]'����t�����|;�lj�G*)��;��]h�,pJ�E�ї�L3�<�.�a_�5eǭ��Ўq�����~B�������:�'�D��B��GS�1��M�V�����K�=���v�?�m�E[ ����e���(A|_T-�����,�1�1�>�IYL�b/�-��p�y���wo�T��������u�CR5���L[ލ�=�0U/�(z(V�ߌ�*S�N��и�,�l�� �����+�:�zV�/�L��c)�^�<2���B�)�	�o�P��#��ő��=���"QUD�_QQ�m�z���k�)g��G�ٷr!��r����U �c�@e��0]˲)8�
8OՔ�̀�,0�P"H����A���!�܏�(�eCS�S��E6��ϝ'��6�!��x�<��M���r�/[ �8�d�YCŴX���z��o�_I*�����՝���"�)�tnRŽҏ�:U��Y����O���f%�m���>��I�ʊ�Չx�&o.���(�D��L�y�;�TW��U+
Թ��#r\̶�MJ3o9��P�0݉���^~ZԽ�w�_ȖR�Nt�E��<�	�jm @���u���Y�ps޺R��E��]�2'0kG��}�TK�c?/����+I;�a [�m4�cN7mym�W�������g$+w3/��A~�pY��Y#u�}	�o�����u�d`�*����x/f��v�NX���?YE�.���^Zp�v4�?ځ���~T8���Qt̫�Ƃ��k��ペ|�w���څ�wX%�y�A��YB�w�@K�5��(i�-=���rͩG{�i�i�ͮT����5$m��x� ���]b�c|�X��$�!�����Y���.W��S٘�mvG��f)�$�&���	tNc@���}q�lJ!��g��7�7�����8Ġ�,kc6]�� �=��FF���|5�m?��XL�<:�d��6��HA-"X5*r���	%a����g�e�S��&y��V>O�d=%�x��|ù�|��4lZ84��Z{��<b2��s#��q�.{cK���/�J��u�T���v��b� ��1�4�b`�M��3���� ��������F �~􄥸:�46|+D�8���U�`����A������G������k$��P@��Q��7O"�� Al��A��W�M���>n��r�ߧ�Уb����;�[x�q�|R�xf� ��pn-r��[�,�C��e@�����ɴ�N�O>��t��p�_�a >\[M	]�����	�����K�v�t�q���Q6z#�i{>�O��C�V�<�&xR���æ@p�jZ�`�������E|���E<������m�x��D:��)ů��e�w�5�,خ0*���P��cs{��|�2�o�>��լ.(Q�U�_+�hC>�R����dT��mB^�Ѭ���.�|bAa���	1˔�]<CW�M��X;��������'@ �հr�%�ւ%v�Ҽ�i���:38\5sN�c���
y��^�O�x�O�$��d�3DA���͆��4�`�8�(�w׈3�!�X奾�m��� ���vf{�̄y�� �g�ʹ��|�<&�"k����`͹��<�ji-=%�؆Y��o.�m�P�|HuL����e%��9Q��L�z���D)�1�Dd���+�uo�Dcj*oU��O1�\���S���REg1=ik��&D���k�o����Ɋa��;J�o��I�#��&[�
W��w�s�=��Y,�n{�����M�?�K��<�X�Ɖ..� ����'��P����±3�U�fy��T�cl2���$Pg��8n���m������h�L>W�n��T�1@���;�cnYoc�JO�_�m2,���{�:�d)�+�n��d�1ޖ^�_��Y	��`?��^Dk[÷�@��7�M������jd��-w�}^u�ii������L;�-�����uȂ3$7B��©cͱ}���<�k�����/$3&��v7
����y�hJ:�j6dK���+�0�S<�M��~`�����@�Yd��?<i`�)H���s����,�ٲvi* �W:�
�8z�|#(0�ڹ��˳��|G�a5}2AZnU���0�]M�(Q>�@�3Րm�#8P(���X{�4B�f�}�Ȥ�i��*Ԥ�^���B;3���jÄ.�`^{��=�C���{��:���!W������R���9MS:j�t[1r۠ա4yz}"�>�#�nԕ@��\�)p�m�0�4��O�Τi
D�����A?���K�Þ�x'7}��E�V��j��	0������G������	���\:Q'�#q���{x���4#��;A����F�E�{N��W�~�_���a!�G������~��(�R���i��R?\+3�o�+��nP�� ���������g�b�@��#:{�F�}�7�_��VOء�MA�MZ��L��z��x�H��u�W�Ħ.��pLY��R���>7�M3�O�	kFlե&��<�����u2��'�Zq�7	��ۏX�
�G����I�^x��Uc`����7�>����;��)Q$�L�z��pw��}Q��;��j;�e��'�5���?8Ǭ5b>j(��X3���NE��an���*X{���!˓dg�}���K3J�~K7�}�Rf�A\PقmL�r�֖�Hb����ުx���ofG��"���R�!H�E�r��`���g�)oy�{tT:��@�X�o(.���Ú�v�^�����`cl��捀󞑾m��n����l}Mx���iY�}ɂt�ܮ�!<�+�'=}ӿ:K�����Qf�%W�&tOS�>o�=���q+:�6������%���h�
�pd��i���ALD��1�E������2D�D�{Vj���������H��$r]����ѡ@J	΍U�p����#�"5/G�!���V�d�,��s��).t�-��u��G1�]�����qقOCě"��lʱ����XSy�>�b@`��4���C�ˁ�I&VY=�H��1��	O��~u9͡[�H��)�L��
�hõ�?��p8BZ5��]-�/�mE~
ȃh������+�v�̘��d���tlӋ���㰪/����aY�?�h��o�j�6V�H�p�V���8s蛼�ý�6�r�����e��x��~�v��H
���Z��^;R|;�$ Yߍ���^��"�3�Ǵ��L�S�;�A�M)0Wy���_���9Ō�P&�j��@�k��a����o��~~�1Ƣ�� ��e��e�L>ؙ-�h�=�6_�`�S��k	������1�����B,�����w�.��0��q��<�<�F��2�-2�T�{��\2R^�K� �/��|�
�@\,P���b��A찑�f/<G33c��y��>���)��>4*��XXw���+j�@�ǈf���1HjY�0͵NЯ�>Rj��>phdU��˻�M)uS��F���WH{�̫ʭ�rJs	�m�'dB����s��E�Y�AsA@���ԧG�w&�ٜS�8�'~a���yV��j��i9d9�Ҋ�?�z���!ӓ��x�`|����pV��TA.�D�u�BЉړ�|e;�et�2J��S�YO�����J#̒�!=�����]9�${G\x-I���x�ݶ���?x`l��MX �E/��&	hGL�5��)�L%�DB�
�};�G� ���0<�
�`-'�vL}�ҋ�9R	���$p1�<��#(E��Q�r	yp=�"��?�k6	�^�&צ��{�������r���HS�&�l��_H8ą�:Tw��~~�tB]��w��I��XP����lG�
i�mS�+���V�����V3���O�g�rl��L���.YhJ/�mx�r;�bS/c�� ,]�F����x��sÌ�������D�B����%�|\�l����w�~�#i7�XJ�1�-���Oyo�]������J]gf�c��򫛿�)�"�Ef����5��=~2#�۩mP�et�G���:Io6���2u�
�d�����h����F�Cl��;bh��9����ʶ�����@��S	%��T�y6?%�:�`!L�$��Z�F*����}����]d-��n�B�;�ڜ���ua*�1`���V;��r$?��E�U@���� V��S�rX�E������E���}��$]��r�z
w��i҈�TMJ��c�N.Lg��v:���h���q��pg��V��qO���	Ä�>��{ʣ���r��(�g^�0}L����Sm��ٹ����|�$tF���h��#%��`nJ��
�=\�lUN����,���Y�q���Q���[���#ݷ3�M�dqwj��$��'@�Pʍ��8����&s^[��7�����1��Uw$�E�<g��f܆3=Ցp�ǨYߊ���W��\��d�Z&�0p�,� �a���������zebiG�� �1��������f-E�Ν��[%
�j�S.�[��W�4��1�������6��	��D���A�AV��]�G��I��=0��(A�8N�Ό��N�gr|uV3�l��|%rK�?U��t�epC�	ϒlw�^0 �iŸ;�W��
W�#�vp��e��8J���k�S��߄K� df�:ѣ2R
W==��u-ա�����dEz�Lܶ�ͧ�p�9����ު��J�mk*��6(�p���q��-��b�y�ͳ�=[�q�1~�G��l�Z��w�dft)���[��㛐Sv�,|�bj8B�N�(1�_�o|s*�ͻ�2a�дBԲ�..�����E��j�M{[�}M�"�`#�9�g*�0�5U�tH߽�iqgp�I�D��{������aѦݥ�>��������ޮ�	��z��p!/ �1y��Rۂ۸����p?_b�C����zpRp�+F�ez�d�C��߿;�#�eۧO�!=���b������|�o�z����t��ȧ�@�&]��)�GĴ!�C���~s;`�5�7���T��n�t�#k�e��A���� _{�{�XGqe3T��F.|j����w>1�K>=��@���9��M���|h�E��C���G�+�D
2���#��[w�-��gĘ?�cU�s`�4#yU[�ĭ#7����*Ƃ�\x3jO<v�3��>�T}��>�p�iCRRQ�Q񅛝����k�D�'�� <��w�y�D�h�U���=�C��������9�# ��OB.�z�eN��V4 k�������MLͅ]i;��y�W�����RA�������:q�r,u�������h
��j?e�; H?X �����`R�U!��!��y���^mh��ƶ��g�.B��D�g'�������>6zl���ûN�	:I 3Jq�B(*n�����]@!�W[3ٯ���
���jF�6����w�B��#�b:s+Hݢڄ���zm�D&�C- T-���`��窥_��p�co�@�}��w�h�@ ���A
_H���׿��*�E��A�ې,z��	+z%�����'/h�?��{?��}��>6��Iҗ�&|���Atd��E�ӝ9��2����{a,�������߱��0��_��0�w�"���A*A?��4B�n"%�c(�1$~{����YW�:t޴��g߸��SڬCڴ|����S�՝`(~T���T)W�� �S�������'�H��d�]�D�p
z]��+?	� *~�lc���ļ�kM��s\4H�a>"�}?R�������u�s�rȧ[�B�ò{ԝY(#uv��y7��+=h���CJ�u�m��p.�o����� Ae�����x_���|��I>�7@ ���ȇm��z�H���3(���ƃ_}��N��J0����U�*!ٸ��>=��R0�n�w(Zb�Ot�PÔi*��1k�;@W�{ez��= ��vŚa��3�㳧�XU ��j�a��G#'e�X&���8��k+��@�5M;�QN%h
�gy)l̂����R����m8���e,�5{�AX�7Eq�{k*��	�� �\�V��`/�e�|�>�Y��� OZ�E{�5$"$r��ew�"_�B��!�v#�#o���r������!TM#bR�>	W��z�r��1m����}��2�Z0�ݥ~qّ���=d h8H�m�aY=�խ���48�z���k�$%MHI1t��7�[H.�K�iО�+D4���2��>y��o�������vv�UD1�Zmy�Y�l���p�����ٚ�Z]��k�d��U�L�!��9Qq~�@�lb�wWI�>��,�
iPx�N�R�ػ�y��J\�uB��@���t[���0�+��O���?�X� SRD�NӞ>ʵOb�ƻ|o�:5�����I��  D[R��2����SHe�ږ�PE��Pd���cl�p�!F�A�cyd3PR���7�B
V|�D��!�c%�p~>o�F4<�5� o��������-a�թ��}�����؅,������M��S�<�b�z�N&�ی�+���%Eqfm� ��|�@�}��C����K�8M��E���w�-�?���Ya$gt�� ƹ������f���n�*����$0�A�zE�[(����;��F,��<������p���qD�y&L��암ˢ��~D���3ۇɄH-��tӬ&�S,x�D����D�h'9&�M-���s�"Y�����t��k/�FॷF��څ��ۅ2r� ��Ɛ(0���G���3�!J)S�S���T�4�_}����6�<Q�^i�j�0�a��X��*��������������|�K\M����$|����J����� �5Ah.h/A1������s؆!%yG�1��#b���x6G�/J��:c%N m�t�T�T�ag�vG��ŗ��X��r�i�[bj�s8��9/���K���dA"�˕/F�{H
���rO��8� ���c6�Dcw���/
���wjv��Dh���}��;A����4�ۜ�DI)�������I�`_��yX��6���7w�_���h[����?���\��eAgX� ��]b)�5�U��M�@������[�fN�az������Z����5���d�W,%�4�B2R� ~<���~��m�9C�cSn��78E�P
#Bu�* ��c��	LhӸ�"�y/=ۿ����7�ȏ�B�LPA�2�	~0+�K:�hÔ`�Ω��ʟk�!4�=ȹ|V��k%})���U�<y�5���+����@JnV	�Z��_�n,�����)v�@;�lmq���_�X���rг�8]|�L�ㄅD߱�Oˍc�b�V3f�H����џ0���r$�1�{ͭfy�)#S��>x�����g� ��}��q�LEh{?jq��2\p�����妳�ʅ�@�U�%@��!�:�� �F���s��JbR�" � �ƈ������יg̽������C��D�r΁�D�JZ����难���[�c�8@��0B)��n�HI�@̵rı� 1w��DT��g};1e�����.qq�	}P���,T�=�uơ�N[PzgF���F����Ԍ�Ϛ1)FW���u�����s��q�E��`SG��Y�F{>�r̛	�N�w���0�w��"ۉ�,��}A����������>�c%n�W��e�ACU!玆�����fu�݉ܽ��eu"� �u�NQ�$��ݵ�OLx��h��X6a8�W����a	U�msf�����\�e�p	~X�K�×	�}�O���\'[-,�������|Щ����=� ����@������Qp���?�{�0.k�cI��u79`r��|S�QdQ��^d�J]+pL+�iI�sR?Mr�_�
d���+B�c�Mཤ`z��7.��ȇ."�F
��Q�� 0��U��Q�����Q�RF���-�J�UEݯzb������K������ިE��v���T��7M��]�"�W;/̓1X~�젝?���J!����8�sb~��g1�k�n����v�����H����ϙE�S%� �y��������*B�����ϟ�+���8J]@P~b���W[���8����Q���,��}��@kî�*2��-�<	E(��\^>�������G�J&�5�t��<��
�r�_΁3u�L-^\�"O�|*�N��@\�p[jM���\~��T5�D)��;��w����+��:M޵~��Z7�l�߶	�����ɉ6G�e�!���t(�׹�����N8�bt��.��] N�=�_��TOn]���l���\^��B���!=x9SҘ"�� �ZҪjv7u��݆$�M0?,0�1�h������%�Iűxrb�����LΔ�/�֧"�6�q���d2���v�4[���ڱ����S�٫e� ��$�	3���a�wY �mt��{���:��c �8:�)��Ma����������I*L2�k�q���Vt�o"M�eaQ�~�)|5A��_�ǛA����я�L��^pIMB�A�1A_��t3Ks�C�,8Nf�}Ւ\X>֣P��?��s���?pBeGU��=4�\�k�N��0�ƺ�ɩy����0J��Wh�I���x�L4�ϊ�SI&���:F�F�/̌���*-��F��L�$/Ih�$c�ή;g8�B~��r#�ٚ��4���ȫC��� ��E��|�2�e���'y�!*w\(|���-į��[��/�ݯθ	��ye�쫅��h� W��{%�ψx¯�D,w\�Y�����W;�K]�[l#%
w �b1�θ�ؗ�>x��./�+�@��~Y��.��gn)�����V���sC�r*�twr��޸tw1��3ϔۆ=��0x�&�2t�P3�ƈ@R\$�3=06g�;{2A����Wu�PT�T����W����4��=�:g�i N�^
����I�{3!�q��u�(�T�Л�U��J�H��y�t��\5O18�=���;"l�E�o�XѾ��=5��\��_2��,��A�H�����r�qT0��-mӍ�Jj��R[%!H��8nsz��/�L�H��c�[���"u��ɑh8���A�ޭ!K8��D%Ȁx��~"p�C#VfX�U�+6�"��C�pn�.g�Z�b�O��i/�������,�5={����2]�p�Qgn @��56�����+����T�u�Q����Q�'����g�/����L3j�3o�2���C��`��#n�|�?ͭV�)ޣ������s������B��	/Y!@
;�� ��h�Y7|��;	�5���F;0K.��G��i���7U;��:��N%��W;Р�^�C��f+�`X��J]��e C=.��r/XtT껈�L�|<Y3Ӏ���pT	��u,.��(�h�e�"R-�/kV��	�d�$�M��^�ed;ç�{�����i���ZaX�t&��qM���� �d]��J: (�k��9����~��e--�1��0��E��<�o<�������g*HYC�7�b����%@k�2�p�z���h&!�����r�춮��g�u����)�լ���51�>аbW�?a�-.T���VV����+ZtxJ�z!�h�ɳr���	��0m�fnAZ�G�F�NZ�p��R��[��4�r��Ќ31{���%>EM�X҄��z��Y�tZ�ݲ�J[����0h���L�����B{�Z�|����c�x$�L��	3|I�{r¶��z�(�,}f�_afԳG_��d��)0�[�\E�_��ݮ5��Y���È��V�%�(�v���.9I���~��S��N29�0�P檬��b94]Ǒ@��0������F� :����4��}8�[D2Nv�>@Bf(����_�%k���/&��������_�ov�,S���݇��B}�<o97�_�9X�9?������" ���C�B�O����׼Z�P�+��g�����_���Ķb��s� ��|U|�kΫM8��������l��@E�dR|�W�Q�c[�����-=�������e�T�u>VktH�smG㹫��&~����2�i�C���������s|���U�0h*���Go�6�ޛt�<�9��3f��R$�� Jt�� V���U��U�ѭ"|K���WCJ��G�!�3�0ՎR�i� d66a���];l���Zx"�p�n����δ9���?`&͔�dQR�(ڟOz��A#�����%g��`�W���!#���AU{�}�`�(�IJ�r�a�����L��_e�xd	�b�<�/�0dŅE]Fӥ�SW�AJw�oHmA5#���{es8���݋���cVY�B/Zni��s$<!G\� �~��a�Km�10�F{=y�����|�4l��C��o�f�K?m�UD�ϱY�I�A�����W�u!�VX�4����a�}�aܿ��u�F5���Z�lF?X��3�������8�Е%:����x�+�}�wh˗����T�g8@1м��l�j�ntz3���稏a\ؤ�"��ݍ��2A�%l���O��3�i��#����A>��nd��;w+r��<�|��SP�,�>S
�%����3�a��w=��k����d,>g܎	3>R�?	��ʣŠ��D������ތ;U�I���">���ƭ U;Z~xր�65���g�d�Tb���L�4&�7�W�<��qc�`4a{�H�v!�}�V��RI%4w�`t���쩬�r��j�M�C�s�}7j�_�t3O=�9�!J�= �d�f �f{{|��
�ћ@��g΀|���g��B��ו����u��!�Kq�&���oR�XuoTk�@5�!�h\�>G��R�x�m��{�FT���"���GU������P���I���h5M�Qd� %�r��u��I�Wj+fj�)T:��I�L����H�����qSC@I7fPq�.#U^� ���Ҋd&wM����b��9�@G�s��2�^B�R�c�V�J�m@\2�&�� �x��=���Q�bS�^�+�kr��6Zy쇽v�JGoc��8]�^-Џ��;��!��3U�y�Z����9��u;
�j%#�|ӡu���%�^a��c����D������(SY���Dd�9�=)%i'SZ��E��M�@b��;8���
��7=$k���X��� ��ѝ���$�g
okm�J�Ϯ��8�د� TՈ�:����>� ٝ%�p#4�eš�"ƞ�G��q���q�ည3�>�q�����1P1z`��Y�t���Z���$D�l&��I�����jaP8�=1&+��L�@��W2��q�H����K,�/H���U���M��]�Q�O�*�Fl~B�ӏdud�3s��=p˵�����d*�=n	lt�%k�Г���@"�s1�&���[GK|=�&)�u���|�/�'�ܵ�JF��ݥ,֪}�?���{�۷?�����`�U)[����%����� +�,���wE������ZUz7j��J�G�Y�HI���ߙv���Ĺ�[w���V]�<�M�'��D����E�y�D���
)Z��&�S��>�9>z�<@Y�$��z�>2�8���m�#<��,$s74 �"_��&tϕU��� ������i�QQL��qL1�Xj�^��u��.�=Q{x^{�����աN����&e�� ��A�R��$]ߋ�Qt��C��5��|-<�|?��@����Ńo:$C�).q�ԥ��K�EjDn��n�?&#yd���G�H�� �t�$��ɱ�ǚ���Gp�I/���V�oS: }W�#��x�~��)UV\�m�CfZ��G�%�u�̘��\�b��o�׮�P �.�9۸���[&���.�}d�9����Cld�v���s8��$6R�]'Ybּ��3�w�E�U�=��Xҡ���g�nl����1��4����CIxf4�ޔ��	^1Y8i��n����Ϝ�h1�W+�(/ЪX0��u~=��=�OƐ�۴&�2L*�	}�7#Dۦƌ5R�Yv��l����C�,�5�X?B�*�(�/���
qGt��A��$��n��MKmn� ^|UK�F�ü����X���^�L�P�����:D�${D �ES�]�R���wj��6���*|1�Ƒm��N�1i}ë�,U�/W ����S��T4�4��T7@npEp^��<=#���y��+@|�?Bs�q�G�2آ��%.37��	.�;�ڲ��ŽkFz�;�����k��u�<�*8�ʜL�(auwe`o�KJpa�	���z����t���HrRs{HnB?6�"8�ZZ� 6��6���	��L�n�=�U��8�н��n�g6��&�X�ڥ!����v�9ȣ2�������S��,P&3�\VC[�u��;'����1�l��΍�)�Q���k�O��5ђJ��zb}&'r�Mz��)��+$��~ ��+�_�iC����U�Y�F~!l#��01H�%D#LfMv
�ǆiҏ ؂�X�"T����������;�I�n����
�^o���r�d�_n� �B8�G��	�d��r�n�]��԰A@�����T���D�e�
+�V�-"��C�(�����?�ٟ�[����Y0����0�G�!��i���h�D/&�m"���Z(�V�=��i����ynSr�/u^MO�SH�6B��L�~�<���e��T0#떷�>�z��~�����a��P�&�C����Օ���|�ÝI��}-�AV�o��R��n�H�D��B��:s���5u�r�o�֭��z�I�Z������ͩ����V灠	Π��v�F��@�C�+��?�SNE���X��~!��D@�����y!�r�� ɒwA*�8#p�&��~6�W�qY�!�^U$g��]�8
�9* YI?by���ڼY�jh�cx��W�Q��aF{���9�Umê�ػ͝w���]1sX��$��y�FqF�:Ə��#n�,�����(ك�X ��\3;-�Ѷ��݁�Q�F�qd1,��8��j�ړ��B<�`���i��-�0
ʡ!&J�q�X�]g=0�P��Ӗ���&	��x���I�iD��)	�H�_{��p=��ާmr�"��#Ğ��Q��Gc{&��}}��!�~��tb�bjv��9��2�6S�bc5��n�'A��4�k�W�1�%�P.�A��q�'�O/j1��hY:�)��JJ�,�՛X!W/��`�Y1-��b���ֹv������/+9 ��;ĝ�ӄ?�g FRO�m�[G���PPIs�{����u�\�:��mA(ds\|s�w��xV�/]��d�u?dp[���OU�h��� l�|���3�8���@8�TY����͓�a����5v\ E9�U��!�攸��-��35[�=�{���M��r�����_x����R@�f�{f���07	�5��"츀�E┓��%�[p_~ī�������y�[�f����^V�P�&�C�4�"�\�pd�������l�;8q�m;���/%M-G��x-��U$��Fh��He�;,�j�b��4�X����h�	"6���0�}��h��xQ�GPK3f?2�v�2�j��y���3`�����J�b����P���)�/ߓ�����#G3�$���
����n��j��lJ�~'�(�����>x�a�aQLni���[�6�\�[03)�Ｕ�v�AF:'�Z	��� ��~2��m~Լ��FT��:�+ד�4Q��Q�V��iW�S%��=�17K��1��m��9�*5�V>l�y�ï�r[<�N��9�������:���n��βM+��������"#�奠5y!y����)go� �U2Z ��io!��&�E|��=<���Z���p�v�tqu���S��b�n���f��������*"!t��=��k�׍�<8���ܛ �Ɏ7T���nc�7�����V��d,�-ܙ��`YU��qT�Uv�6�l��Ӷ'։���M�<N����9f���'|�*9��"X�?�{ƈ���Q�Y��@���"�o٥�(�o�]�5<=⢫�/SI=N|��h��g��b�˿���k��7���ԧ���d���Us�I��l��w<<O9�l�.��zϫ������re����Ԡ�q�#U���`'qU���k �\��U�����
=��4�H��x)�hp�+�ZBj1�7"�X�b�H�s�Q�>�o�����w�F@$�����h��\�St��Fy�0��b�d��s���h{F*�;`�~4��3�c�M,%�h\�#l�(a��3�i"F@�X(Q�M`K���7:�p��:�=�d��/(�/s�9��iCfo�zIKLtĮ�d���.`E�t���*$�ݝ��Ė$����*Y|-���9��b�IS�,B�7�3������rk�wM�8���8��'�ɗ�%�4��?ن�ϠL��5f	I��m��ـ.���v����Z��^\��]a�F}"h�� �+Ƙ|��]��=%�/��C��v���;)����xa��
���3Ͽ������ufJ�)A��Ռ.*��>:��sڡ�ʹ����hA���ks"�����'���&�����I�=�qW��i�iro�M6J0����V<5u�ua?����������0A�O8�����\�e���28����e''���F�2n�n#9���7�}���׿om�X��I%�%��$��F�i˙3�y���~�CMT�k��x~�'[p����H ��{�g��&�3����Ĥ��
Ω�*ݞ0h^5D�:1�׻��$jX5R��o�v�M/U8T���1�Ii��^�J����ۢ�Q�&�D�|h��+�K�rY��0���;aj�&��u�֛���	�5��9y���_N��WV�)�T5�Ɉ�Bp��x�Ѝ$�m����-&��ZP5k>\�@�#)I �i���qB���)̢^��N�-INe}`���@-dW_f ��f��A����kϋ��ˁ��nִ��)�u���lU�-�+'�Ȏ�aWk���lH�-"t��{�ģ�8��O�B;�-�`.#iT��Hm�J�f����!���6!�1֫��S�׵��+c�R3��(S�v���ܝ\�.����>��(	��*�B���9L����fM�R�����M�qB�ם:_~
{l���glrۏ���I�	C�=��UR]1$��lmv�x:��9�l���Z�j+(��'C�����ġ�ķ�)�r�u��2�}JÊ7�yc��#�m����o$#�>_E�%���c����V��.������'����n�AiNB2��PffQ�_W$J�_=��;R2�xG����DL�
Qj~���Z���*�Nb�"v H}Ī���j�P���	ǵ��H͜i@�Y8#��H�S�k=I�S^��;vŉ���h61�m�Vs?�����N`b~�j�Y����`LT�av�[��g�Uݵ'y�H��H��7�le�QJ�[ύ3�"�R�n�-�F���5�&�K��)i�=�"��M���m9� ！�QZ�"�尞�~byhq�5&f�3�����N�?Z4�ZF.���g�?����2����`vE$J��;}�w�Zl&��4s �P"�6��Ϯ��G���ǹ.��� �����.J*q��nZ�T�3rS0)4p,��6����az�/D)�@�@����SZ�ˁ1���eA��N�1+2�(�&ܠ=m��0uJh�蹊��KӠO���:Q�ʂ��API��<������՝�� D��79C��ӁO$(��#�-u��3�W���E��|[�!	�������.7��ZoCIT�Rӄt���H�;q��g�%����G�1�لc˾^Y�QYG����
Ca�2z��V�QA�1j ��E.��o���̦<���ۻ���rs�����:tVҦ.�4��Q�"����I.����ă�m�EZ� B�(�������,��! ����"BD���,.�Z�/��U==>ɻ�N92FQG�m��&϶,W!]Q�`S�ZC埄�:��e��~'W�u���
���3y�/@�R9�묋(xKR����r�-jr�"���q���U��:��t��G_�?H~�$EU����2��蠯��U�@�*o��?5\Y�;h���U��9ciq�D�vk�4vc���z1�A8��{"�����:Z�M�Wmѵ?,�s�ߕ����؇��L��9��v�Dt��q���Zw��c�,�Ŋ��Ľm�|_��_/8���V���3l�T#P�i�`T�6�e���qd��5HG����aw��4����Nm�+���������xj(v�eac!g���!B�z&���5�#�8��Ʊ���K��̻�䭠��*nQ�Ϳ�������|���~v��z���d-��_��.G�t�8�~�Ý��`�����d���T��R���-�Ӫ���e	&���9ʗޅ�;t�T{�R6O�~��dP����oB[{����^!����� @�=����(��5�l	���^�Q?�F����3�G����,�S���^��P�ވ�s�M�� �[L��Iez��L�%Þ^�.	�/ƅˑ\���{�$4Cx�W��;.4��U`H�ۡK���.���N)+���z��|P�����'I���e�=M �X ��p��%H���˓�X�`Sd̾<�y���+�s 8�E��kzeSA[;��tm�;���?���_�C�R	�}����_m�)��Vٸ�S�~�*��P<1\��?��p��Ӱ�����[f���h8D9��0�T��0a��U[����iC�D:_��\AH���'�۶���?�7��� �)�_L.���t-�AA�� �7$E��*Ų��ۧ�ٝ,6�{U�E1�P�[���s�<�+{����#ָ�+��-�����:˳��� �T�I��'ǀmH�9R@�~,|��N�#G�`bd;n����3�r�s���tpJ�Vg���=�"c6����i\-�W�A�H�ї��f������a���4	�g"$�5�3��4˳X�T2FoQ�-@1}�n����,w��ų0N���׶��3.M�L������H�JoP��؃>�,~�KR'�7���X��}\��~S��}��2��-q��/�2�x��YC@�#*���|�I�����~�rD�t�2�����:KqNz�/��&	�ϿU�j��1��YCŴ޴�O�S��p'Fgɤt�0�bG�.������Oz܏��Yn�V��hK��c8�
�7\���P�\y�3�k�n�L5(���Qn��eӕ��R��Ȫ;Q,b�vY>d-�'�#�~â���K=8�qGto�[^/�`?
)�W� �R�I*q
#z�$"mKC���4����<�ޫN���5QD�檿���u��m*����υ�] \����0�Y��N��6��6x�0�!��
g!����B`e��Eك����
	�L�K�l�b����),`i���t��-y���d��ɽJrf���x��]�a<_'�R;'L=4:l�	��玖���ޥ&����d@R �U��V�	��Ֆ� 0�Hz��(͋yױ���&����j�mU���P������u������%5B{�خ�(m�y7M��~$Lr �ں��L�e��Z�4�#�����i5�]ץe#�ߌ�?�ķ�ܨD5h�Xeo�.o�֦*��Lh$TI-q�4�
��<�^5���8Y�y7ۼ��>3z�����4eOg�P���7���R�l\�?Zc�|�l���'��������{E�Bۂbxk;���ɘ�LuLD�Db���n�x&�1�KX����	������P�SP����wlMb)$#�>C���4�l��P�-"�q�L2)�VcͲ��[6�*���q2fa�ȧ�n]Ȣ��[�G)�x[t��|�c�OPvI�k�9�S	�9b�n=���R�OO̚p<��ݼ��$����o!��$$�����9'Nj켃f0��o�w�HB�'���3���pW�o��d�+�����"���*;Ͷj�Y�ti\��-S�%,7&
�Q���� s��`{k?�N�f�y���r�y�U9r��-F�w�I�2�����t���
A�-��ۣ�p�<E�,qrj�լ�G{�We{�(�l�Z��b.�9��H�NA�&$=�+Z�k�t]0
N��ܪ��U�K���(¨-k~�ph�K��i�����vfK�+.��w�ҙ���V�B��sa�K��[i_$�v�$����u@�mN�u�1��-%���J��t�~/,̦*��(�E�o�����8��.�l��82#�Ӌ�@�G%�erL�"�m��� �%?"�	bl�o������k�t�*����;՞���+DFȦ�p�2��ltD�c ��wTg|��:ad&��@s9���'=��_u�v��y�	Ht��м7��$8�X��&�u��XP�#�˩y��W��?2a�O�wأl����c=�t��m�M��><�W�)Cz�V_�آO�&5���U�>)��yn3g3�T��}�k�-k�<��&�D���*@X��\���"-��P��������1���c����a'���)fS�:������� Z�@�{u�S��4':�Py���=ui�v^�������oP����i��c͢�a�W���^y�G���FDq(8Q�����Z�_���A�^����d��nHϬ�gw�G#a5���=���xgP(��мA���~�rY��Ql1q��D�NoY���iݬ�m�
jse��^�c�[$��2�>qƓ�&<�F=��n����������ޔ)�[�	�p�0Ju����^b�*�@#ܐ�,"���M[C2����4Y� ᾩ�n��.U`�����`�10�`zK�U�Ȋ"�|1�Y��٩�̻�TP�>�$89�3 �{�JvW�+�6��zߴ�#�I-����:����o9!��\ ��d���b��ǃ*ѳ>����r :*��/)�����RB.�-ھǃ�T^
�6���3j�;�Y�Qü��أ����f�ņ��^��(���M}��;����P���F�0�c���Jn=fK�e��b�[��f�1}����C]<H�%������>�vt�!�gZi~��X�*��S��l"`�]ݧ�(����`ʊ��'�'�{��J��t;�;:J(�p�UN���QN�y����/�ԅ�2��sQ��i/y�I�NEF��!�*�M��Y4���>֭��C+�5w����3ݚ-F������L��_��(���}>�֎<�ΥRJ��
K��cT<����N���TB_u4����ȝP:��u v;.*�B�t<��h�(��4"◡�܃c�2D�ZD/�`sU�U����>b�@a�;&W�*3Y�e��Z������������}c���0,�Zn��B�e����J����Y�"mvM`�8�/Un���!�3Zt\�#�h�H}2s�g���%�l��#h��	�zԃ��4[�1����7K��D+8ÿ�}���[K�TE��OcQp\	�7��NK��x���Q�>.v7<f�@����,@u���q^����ېe�L~ "�� ŭ~m�1>ӫs�\�D�#�UTP�น��Q#<�dJ���_~�ǽ}Q�%ت�}�P��Z�	�2P�Jje"2zS�8F8
�vdF Zy�;��w��R)�m�M��Lt{�Ä_�q��Rc�=�3�=UW��O��g�9y�uƐ��gԶj�/��n)fI��H����&Zn���%[^~�v0̺�M�l> #/�ˠQ'��V?�0Vd��#U,k\����; -Xꥤ�r������t�&�>�Fw�s�\�GYDiaρb�J5��MJ�-�?����]�S���)uJ����z'~���-D�z�i�4�0,y��'?�~�Ѵ:k������^|�Z# $N&ҏm�i.u���rb>��էz� ޯ�����z2Ҥ��t5�z3B7YL{�5Ӛ0V2�����n�lޜ�������u���Mz�YI��l��TOĔ]+v��u�����yV���P��N����l! f6b4$�����[�x�[Y�w ��ϝ���H�;RM� ��gz��2=�΃�XN�b/��6FT�F6�K����6�k��HP���9��������z-��龞Bs�RK�#��_�AEC�	�CX��D�SJp�vcQQ0F�G]�J�V��4G�g��1"�}}{��c���Zu
p�1��(�q*"��<�nL�+�c��l�7��ݷ�+�9*�Y�H�oԴ�e5hd�~�J���7@��&`(��|���	—��Zn��<�����f�GJR/��Ty��	�T��F%(�a._�I
L�C�2���i��!�e$-�d��R5"�f��Z���|*p�&�L�|�w(���)�jy������V�9A_;O���� bh����u�rq^'���O�v�s �����6�V�%�KF,�a4��g��j���/���X[��@��;���Mo��Tprm�5*�g���4:6�Lh�cb&f�kHLTs�@���&����`������VM�_��!�ѕ�/��������fW��w&8~/�2g��HE�qp��ɑ۹w�����
����(��`S��H��n�U��r�P)zv0]�Ĳ&�����u��H	�)�\�tv�.¢�$\�Kӂ--�rrBQe�����B�a�		��-�E�P��DJlv|�:R�+�W�O<� �/Y�I���̿���c��5��f�aW`�E;�Q��i%u��0�k�-	�,wlo]�g�Ʀ��A���Ka<^Y��X�B�޶���Vo>@
�Q���
�{�K�˽�i��A��C��8����)�.��12&]әoJ��ٵ7:�ipGH�ḧ�yd� �.qv���`���Y�y7�6�sRl�Ne�K�Rg*��'H;I~�)�v�L+'��#����VI��T=<:�*�l�ԡ�',q�隇-5Ga0G���3�ϓ���&��ʹ��}�@���!�U�BN�^~FP�n;��*=��1ц������z����M��Ń�r̋J)꠮(��Z��HUĦH�7R��u�d]d'���[�n�2u?$�K�bl/
�&g`J��p3Q��Q3�m�	�n�%i��+]���֖tv?��r�y������ŊH��.���8����%G5h�y�����5�Ro�b"�=�/jc�1� �"�Ԅ�X�m�\�X��&w��20�(W ���G?%�d��P��q^��<@�$ABm�鵍Z bo��P�1�p��d�.�g�t�3�^�J�*>���1"ъZd8��݅~>�#¼�+>K�}v�/�F��Nj�/X�'�י]�7|R��5s^6n�:��d��16��6H�9�S]E�x2D.�?��?L��r	�]�n�,?"ctOP��;�3��x�p��h2)y�l҇)�F ���o�6zް�-��lʩh.�Fe;�G�+:}�$���0.��z���Jt
\�l�����A�˧�5���ͨ�扔|�m��8F�,�wϚ��-�H��Y�Ζ4��N|&�3Z��)Q�6�	�;��uhVGm�2Y��� 8�>w�E�%X閾�g��`P����B��Z�;�����(fD��K&��@5�����\��XCy��4���XpX�C%���hYF0��i.^��5J��8��1dX��!�ː��nb��q��{t�h W�%K>p�2�:��J�$���N nR��c�7E���Mq���xyY
�گ�[x�QTl��_�ؖ��4|Ы����b�<���TA!�>KE�J�j�I�χ%�<\>�B���}ֲfix2]�}k�1��%O��P	;LD'�h tw�Cz�$�(/����?�YM�T��d�γ�t$.�P�V����?]��7B���s����_�+���he�[�����T�g׀�l��]�Y�S�͍�l;�g��KpJl�>&*�R,���)z�v?�a�+�i�`��F�QZ'��4o�ն��������r<�������2u�UզO�!�S�ʉ�
l3zZjZ����&J~q���p�eUY��;��\W]~�(<_"�LQ��)�#K64�����c��M��xGü�.�-��"����C�-�-��೮�+T��:��'fl �=ն;K7)��pa4:u'��#������q󨫾@���o�`�w�o�5��U�e��?-�=� �@���=�L��P�C�br,�o�@G�Y�P���M��7��;7a	�'}R�;F�5��W]�f	���;��`��(Sh�������Ā��!�kD��g8M��)lFB.�O
Z�fTK�<���w9��q�H�Z�O���Z�������^��q���C������א�X@���|��5@���w� ��(�LQ)ކl��z�]Ň��H���t�$�G�-��ʊ��+@���P&[��eEQa�����{A��
Y&� �Բ5j)~����#}b�QI�"�l0���X�x�X��tlN�:��\�Ã��s>�U�;* ��#Q�2�}0䩧�^h`�@�%�⨯ʔ#�����	烪�V	��ݒ�}�I���@G5�aHL ;���{
�o)�G.q�>���Qs��{�g�OR�6o� v_�8_�[��I��v�͔Q������e�(�������;��9ĕe ׯS�!�4��r����p�VM��)܋�(y����_*��XT,+/����e�BǑvP��@Kc���AMdJb�
bD������Uy;��$����xT��8�Q�c�(���E��,��Fw`X�>��XV�לQ8��h��S���ү���h�xg׭�e���*�Z�գ�����@w���N����xh#]I���1qؤ;J�A�RC�"�R_�o[�%NЉ�x�������ұ;{5!��ؿ!f�Q�x���gw�$�����u�F�y#:�^>U	3'a�'΀R��%�7!��/� V2��������e|$�xDb$KQ�/�O�R��j��5���x�H:Y�l���z����㉸ȨZ���WD��c�z�ɳu�8�2�����PȤ�k�^9H%M�[�yS�i�Ē��������x�
���ɣ�!_��ǨІ�q
8�6s�<Iw2�	���ms����m���ɭ�F�7���������%V�e��^�w��v>Z�{���gQ�xH�a����~I{OFt�т�4��ఄ�bM*�4{��s�  _EW�;SEt�֤��	���^>� }���GdD'�bd�J,w�O>0��,���6x���~��� -�����2��ux_��S�̹�����pF��p�F�B�&��fi��o�1�8.[X`W"Q�4��u9h�Nqw�ڳn��4�B}��vڜ�r�)xԓ̢$J&�C��Kl&M�>����w����({��?���Nj�'�6`c`	gl��n�2��<Z��ڰ:�@�yۊ]=Yv�IL^Y8'"�wt��!H9|��ʀ�ʂ��NmQ�b��FFjƵ�cX�	 �5s�F�>-�8���1��ʊ�M�r��� ��,i;���2=��P*���@ZL^�6��=�K�P��T��}�z����-��c��ݖ�WÐ�xs#<>�n��'k�g'���c4�{`��`�a��,��;��z^�I�X1=�d�N�"S'�	��R�Y�^��>`�U�*B��"+%^�($���i_�5>ߜ�[��'�M��7�U܆룞��yJa�]ʳ�������\͌��'��+�����L��O�7���X[��"c�P�2�w`������WB)\YW��.�&)LI ���q�=/sL�2C@�麫�bY��ZQ�U�����a��D(�}Xտ�_�O`�'0;*@�� W�����Fk���D)��l�l�����P��$,��9t������]� ?z��G{�xw�#Ig�T�t�D���=�J_��9Ig�o��(����-ɰ�q�BN��*ڎ�;���/����#���|��Q���h���=&��D9��u�A$�G�������o3͹H��r�2���9����T�/	��"W-�*u�h�Ǧ���)~�A�O�H��ٓ�:~챋ʏJ�[xj!D?�k�"���m׍A�O�%�M�DT�u;��i��!����>���ǁ
[��m�y����A�}�o�.�q3[vw�e�O*p-�4�B�#^cf���n�'۠d��;�����\:��Ҙeq���$��m��CY`�kӭo��u������<U��i!�%k0O�U�k�)����T�q�t9�9�k�IZDԡ�ҷs�~��}�R�i���{�f`�}�5s���3g�ъ��P����f�-��ʐO���C
�c|�(
��~������j_�� [;ˋ=�� �+w����VVFd{
)~>�w�г$))��5&]0\cgށ���8	���5Oޜ4W��߾(ኟ�u��RfJĴ�bRJ�蝏^�H�(<�G�u�[d���e�u����1nL6�B�	O8��s��ɟA����g�O'�K�2����pu��s�C�BF>����ޛ��\�)�o�݂��=y6��J��y�.�<�4���\��Ne��1�8�5_��g���jz����5S'\���ѵ"̚��;�p�}�q�K6���ko�}h���U�[Pt)��j�q�,�"K}�Ww�Ll��یh���E��/	N�(���w@ ��DW�s����'��Y�z�cUc�Z�z�l�Y�kk)����z/�tv���[g��<?�KU����}���KZ�@�2|x蒖����&,k���V$�*��f�ɠdU�.4�Q �������C^~EO�JaS��֖~Y٣�3<������N���|J!2_+��a���%�����Gap(�h�rj~d��V��E�Y���0�/�U�u,���79q���҆�ִ���-o@����_��r��	�TbS
<j��c1\�n�?S�ݺ�R�Y��Y�y��������٪�s�.�e�n��C7�������tS��KR'�o0�Hh!��y{x��X���e��xא {F_Ѧ��}04�Q×�ť1��sd��i��0�o��0�.[�t{��q{NX��~4x������ၪO4<Wї&3����V�/����M��԰���[�f�_l�.�&��(�T���<�ر���i�U肟t�0��U�n��w0e^AWS���׬���Aa@$�Qe�*PSZ�i�AU	�$2�	�%ztќ��E�tq��f5y���zNW�'�;���깖s�s.�|�ʾ���~3�V����&�� ��s�k�Y�3Zcɲ)�?��P'�j��ٛ�+�)�[,ge9�*���߿_���������U ɒ�,����6��A������L'7�F1�Z:��:��}�E���U����T�e���Ʉ;�K�H(֑����1/\�v\���)AJXH��	Y����b�����������~}jG�1��C��]��)ڣ1F�:l�#0�QN\�,V��b4$���]�VO#c���Cʑ��2*�c{��Xv�=Q���@�Ҡ�^^5ʊ��!�C�_�k�<Z� ��1�ܙ����q6�-����W+����Z�J���ѐvd� ���;��f��&�=zw���u%��[��N�P�Ԑz �gK&ެ��%�yW����3���T���q �q�J�1��;�_�4 �))�����֡N�Y��ڻU�/<V��l;x�<W�/Q�.�ڎ�J�b���u�^$��,�;=��;l{��e�f\؋��6��+R{��ыUy�#��t��\��p}
�H�vI�N�=�+�*N�!%��/g�@�y���}&��c�T�[tr������B�]'0���8���Ɛ��Z_~�j雘"���;�	��Wm�.�d�%�1�W�m��֜��P�e?��'�5�������Pc��� ��u}��|ru�������1��dО�[��v� �4+`��fy��$��[�5���/�������@��R�Dy��p<\h_��r~pf�eo���IG)��������6;.'���m��˧*�Ӵ���(? mEz���M5�R�9!��D�c�\*0$Gr��o.�)U����G�S ������^1�pc��¨���^
�����A�6)˭n��i �De/^Ќ��P�Cg)w���{�-���������V��SߏD�Ō��1�epl��g�ݺ�p�̸6֧¥��M,neYH��]2,��׭x���~�ώ�$<kVF�-V�'�����]5b"^6}���|�I�l�/<=
���O�L����N/(�	��<�"��%3����5���G8U����<8��h��|n/��"ea����ǅ��n�T8�;� U��Î�s#��1r��D��Z��n�@e��M��]�q郳X��õ�C�Y��ʳѯ���o�ۼ!�d��~izF�G6�� ̬�����9c�9V#1e?�}g�_X�Rg�i�'�㷭mI/��}��Н$��Ķ�x(d"�O����KXX\�8�a�b�G�;0Ԏ�ߊ�<M!Le�<��v�Qz TE&v��Kչ�u<�˼��v���T� g�s�Wke��%UAs:���P����R�V�F�OS�:��5Ȭ
�~ϝv^D�srkZO�����xҳd�|�kf�S�!u�y��M��|���AV�p��*�Ӓ�#�5�5 �s(������Ջ�B$a��ؗ��6��+��o�(�a�p�֬v�ɚ�8�\;Mم�/���^�+�v��_�B������m/>�R�Z�.�Ξu�R�����LB�B"仗`(�B���R�B$�aц
�W�),�2���ڠ[T���Py��\��]�p\�|!����@����c��/ՙ\�a$^�eI٪�<ڻ��aI,�$��ar����W��7�f�-�ݻ�����,z��\K��Ȓ�������F�Mg���f�"a}O���g�m���(�X2l�3Ӑ����O�}�;xk1.�q���~�4$X3T㴗ԋ�g����٠ւ�C6����U�O5óV��$�b���2���0��������9�"��m��
i��G8�lW���̰ò�߀����t���������B��ls����Uh�~��CBdQ�9k }�8�޽�}+m���cƊ,$C)�[�r�Im��f��̖8���.rW�\q! �㺣�t�oM����С����x.��� ��$|�.B��JL%nD{�w�t$qGW�_O�Qj]�Wh�ݷ^(����>�Yt���4��W�k�i�=�pA;����Ɩ���Є�T
G��F����IQ���*` '�RS����B�GD��8|X�Yv���~ܗpf��;�'O�N����p|�c_Hy�	��hK�*nu��������2]�L�c#��$���\��/�ZS��n�V�>bW�g��ߏ�Ӈ?$��5�F������F�46d6+�%���OcgIc�_s�)qߢ���q��x�!f��������?���7���T�x�HU�[��R'��d8����@,k��~Z���A;���ȪSR��k�_#�(���g��sݝ��Ʌ��������ѻ��Ɨ�+G�����u��h�-(�6�O[�8�|08��қ]x�����a:=[I'�y55 �Z���1��/��!���
-�\��w��?�%���kf6���x;�m_|$� ���
3� v�}���q]
V,?�#���bp@+3O���-�@���DQ�S�z�ZKy*x�s#��Q_0���e�v�:M�H�x�_\���f�9Պ[T�%��&���x��3h4�.�hr� T�({�;�?�vt!���ٟ-�n�b��~��v��9�Ŗ(z5��4� �j���8�Ӟ�χ��ev��C�[�D�+VY��pJ60��C����KBhg0��Iu����>J�T���	Pu��D�I�R"�.�<L��êI����#�`*-��(G�ه��<q�u�&ɒ�x�tQ�]q9Ć���X�����&C �kH�#�c'݅��mV��榚�c d[/چN�a���M�4�TrwX�Fq�}���!/��6���%kr�?~B����IŇ���Z�K ⚔��X����6v��>�Dz}g�e�KH��s�w}޿y���[�B�"��T�Da�����H��<2�M��X?�WU����~L�<�_fd���n�|�O�6{�67��I�d6Zdm�����'ƽ䃇PM�S+�U���9�l�.��
���İ��?�	�gz��u�%$k��\Сmz��f�16�$�b�V��i*u5��İ0�@uh��x���XI4���o���6�R���#PCس����?��oܝ��Vu!hl�-Q*�,]�y�~�D�DD�?"�wh��Wf�ØH�t���+�A'm-�ɜ.bo�n�0r���a:��N�c<4���bVtl��C;�0zA��A2�hS.bN��(Q��q���Ʈm������n�íѵw箃�;����Dh�eW��|��A`�~y+���6S{���t����N�nZ	�+
4�^V��w�r���Ϭ�;�u�3�,����6��D��,նڀ�o�c��~�O*��;�>����ʺ�_� l�vH�NB��T���������R���~����@���%��9DETG��V,pV5��Q�D)
gB�A�Ke�<�Z�[j�H��3��?�
,���&ld��o��:�z��7Մk�j̛`N�μL��P�@�w�d'�g�tlM� [�SBR˯>�Y�
#�O����~��7CG���V�|F�t��C�"���rl�I�T���Y�.�VA�[k�����	`t��aR�LgD[ks���	 ŋ�����5=�D]�z/�Ķ+��Vy+P'!�T?��L�����Y|�l��{x#�=�>��JhA�.U��yUW=,랂AC���j���D���B�B�	��V�B�fT����Z�z��#wO�\�9K�Yy͸�����='E�&��m'���b �;,�s��d@�@:��S���؆�7}��� d59%3�VT%}L�z�}�F, /�>fY9������2��e��1��� =/0w��MD 0��H7	�G5�X��T�&mKRRF?��M6���&�}�u�6�pz�C֐Ȯ�6������:	����K���4,l��{�(�@��C
/�&i���Jo���1�R�:)%^
F���[܊9�f��6�!�KB{#Q���_���]��m�����A!�Wc�� l�O
�!]�G��q�V.�����B�pϿiogӂ<������aP�7�IiRs��U
�;x�l�є����@j��6�k���f�ᅃ4�0̄�r�饾�V �Z�o�d�{��6�5)�����m��{����Vp�j͸��<��5�!2��M=��4�tfv�f:�Z�Co项�i���G�\�a7}���!�YFu�J��,��پ�VV� ��t���a��ƽ$MB�;R8��2u��L�g���Bws�*�E����I{q�9a������٘�I�3�e���Ww;��?�N;� }8�q=V%�'a�*}��qh���������C,ʇ��v<�7����RޡG\'�ݼ�ߙ8�r��N!y�'�pg� �Z�R)c$�"������}г:z�h��y�S�֍�SP�7���������������0kq$�v"�iAvػD�E��9�x�ς���
+���j.�=���� Dc�����o>��� �V�	$�dR��S5��9:�**$�<��<,��ЕT��B�6�A2��w����<���R�h��U�p+;�>��{#I�����i[��~��C(u==='�K�U���i���T_-@����]k����N~���K�hm�Ơt}Z�?��P�s$ON��lt����dAɉ_����Z::�Q�/@Z%׳��"B��י��2�q+�2��c���C~ui��Ǳ�Kլ2�ސ�@Ǟ�r�[�+y��\��'�a �<�5��]���S�	�/��'H��%����6Sx*W���)^$��u��-5A]Vp��Їa���U���D5r����ԧ6XP����7����8.h�(�c�Qgc��Z|We�=��j��h֟ҠM��K556T���5>Tb��w�����>�F��MV�h:/U�$�*i�>Ľ=3>�=����*���2k�@�?���5��!x��ld5�^�i;�3n��y�tT8��҇^����yOڬ�����(����:8	w�K��\Z�ͥ��}k��x�����Y��A��P$�m���y�ܭ�l�Zpl������鏟�_;�k��3r�4S �W�c�T� �����N����ļ�ɾ��p��;�����F�����,��`w�p��横uW��&�3F�6'sR�U�'*�`j�o�	�/��V���OU6Q.�OU-������h�%
T_����ٙϵ�b�,��O��r���R`q�e� ̑Q�u�e&C��8�i�G)0�#��&�G1���s
��E���Q�
� 4��R6�;��f�gxB�"����b�19,�ԡj�q^Wd�D&�����6dϰ� ��M�4X�Fù�T�����&�|Q�4SZ2�gۓ� ��`bS�K���;a�Xo����J�˕*�1p�!�ik�q̰�Q�v�OW��[��p������M�°zd��%�WhCͰ
�U��'Ւpj�O������%�.s9��a
4P���E�s��}�^��B�R;bѯ�'kۄ,�* 	��L�>��� ��%����r�)�&����$���챤�HO�x�����(C�$l�%���#��m�w����Y�1�Ĭ�:j�$V���H��жk��2��l�����$�7�#l>�e�/s;��R%����'z�mJ�/L�N�7x�c�2��,?�ޚ��p*�~B0�X#\��-L?�T|�|�[[5j��KGq}� �dL����L�NmƃT�g���^KS��++��-V�	JI�fě�Rn�3J��׹2�3�K}�<�BZ�֝@��֔�Vn>Eͱ=�)b֫��s�;��?q�kG mp`����хH���a)I�X߈Ѱ����j;��2ďn�Ҝ��K�PT���
"*[�A��ʘeh�F>�;�=;�,�pO�K�f[i zP��R���~4��?|�]�e+l�+�n%�N���1����ES��#S]�_�2Q��s�RGBN�zoV[%�e�ŷ�N3�b��~���뒣M�������a����!Й?Ϭw��xG�~�\�e�Y�q�0�Ć�k�-C���]�%H�ݟX9����	j:v#�����s�RQ�6o�]��<-�O%M	.ܚ���/��Ʉ��@MZꞘP��U��&��?̢�ܲ(-�#�Ԯ��BCz�F�@+����u�H�Yٌ*$�����%T��p�js1K6���<�������PĖ�Uu����o���u5O	sxaҔ_m�{[�I���9��,=A��I�O�K���B����#�yo0�W��xo���-S���c #�Q5m�A!֪�]%OGc5�P��C��9gJ��� ��<� Z����8�Zˈ���gɰ=�1�x=Xvey�J��
�qǰM����S�~�������4,�}���iLQ�Uڅ�b�Ϫn��׼�i�:���/ĉ2@�D�~4�?+��@}-��X�2�cb={��PO5�{�A�톹������9L�@A'�[-�o���1[�b\$f< ����aBHa����%��Z��-Jq��&hνB}/?���DE�[?�!�� ɤ\���V��%7�C�x���bN҅�f�EЄ��4�ç���ܔ��¯k�#B:�<����]-';�ef��>����Y,�E�T(�m�9բ��8X#n��͌m1�^jk��m=�����7���� �<$��W�/U�qCť����*�]�\���{�~�"�T�,�}v H�,�6;�*��\�
��(�7HY���n%"«��n�QƟ�y]}J5R��i���fL0a�D�u6gN2S9]V��v�wZOR1��*R{:3/$%A�g��J|q��|�~�1PZ�\��%櫛j��z� ���WpBgM�����lkE�>��y<;7��0$�Ѐ���H凴`�Ʒ�\���Z��i"���# }�~qŖ�����y��ͷ�o���,F�3�0�n�2hJ)�&ECg��$���7�h��ԭ̳Q �[Z���ڰ�-E���F<�����Z���FB���&뭏?�=��hUa8�r=6�^}¹ծX=c�+y��"�'}��f=*�������X�6��o ΰSjM�����ǀ��B�8�i�u�=�,��u-" �9��V3�Y�ӭ��y�>�V���ᡞ�hZ�T[i�Rtbw��7�򵁄,�~%��n�_d�[�Rv�[3 p����h�  �^��b-ͩ�YH�h�`��*��F��� 0ă�����̖䶹6�B�����LW\vXы�wr �B�-�h׫g~*p���w��*�pY������q�QE��M�Z�U�;�-���K؈~�A}9ւ���,&;)�����͂]MA��qcA���x�{�5�;�++&�{ >��3g��Ig]z%x�sŝ�J ü�y0[��پ*mxpEw~�ǻ���{@���x���.��X���F��R�{�'6����n��5�<]���_�0!��L��>3a��YP���A\H�ã�u�;��˻����Q-�,cӬ�.�M7�[0@�JF�z�m�8˒T�� _yF@p-��f�������������t '�bEW� �>�V� �N0P�>Y(9���?J�Q��w�}���M�)���N��:x^^�U��c��ht�<������RD�=�;��ӖX�������-O[@�h��q�;&���Uf?����h׾0�r�*�0*f�5�[�Hv�Č����-����&�c�(���1��z����� J{�7��<d���rr�9�b}Ԃ�|��ĉ���,s�L�j�-��7��Ԙ�� �u>8m��7�~��ɛ�v��;��d c=r�U�sؕ�� �Qf���*
�nI����J�1���Z�O�9�~ț���Ki�@��`+HJiH若2)���ܕ�"�N�����M�r�8����S��G;�, L���gk�Q�q�����Na����u��&�v��VP�k��E
t�u�zb�\lѢ5xH���˞h!_�<y��pd� ��x��a���Q����C��/��V��~��7 �i�SX�����B[DDO`���J�O��l},��>("��c�혤����49�Ш�G�V�.�O>�(�QkY���>�������?g��[f�>��o<#�J�����Q(	/k	���9=չ{v�����-�m���]^0]u��*�;R��&cU��4jxG��i�}��k:�g��|?�(��)�a��i��5���Pj���Ne~6u������埍i��x"�ړ@�4�R�a�S./��QK��V�q�c%��lbw��I�ʾ�Ю+1���M�lW�$��`0x0�LSb��N�p��t��(�6(�+�V+	!���C�}3'Cm��UA�O|�EQG]�1z:PI���-�x�H����w1���tu��)&�؄iz��2�i�	�L��?IAz^���9��HfJ�-)�DOl
þ?%_JG �]uĽ�Q��6��c����:.+���*�$��
�X<'����{
�	[+@Rڶ�l�1�_K<���?kRw���x�{���]��~��F���1����-|uޘW3��A��̅�(�OW�*��+:�~���~��T6��M�NŃ�m�҇���A�<9bc�kIࣃ|�f��eq��h�$=7	��@:���^Y������ofD���u4����.��[4;?{|�ivHCaJ���e����wQ+����������J>���ܾ�w'A�]�����%�w�H~O�D���MO���X+]���h[7gs����� �2Uӓ���tN?�x\{��|Y�\
��p�|iۄ��H�C5��~ 5CҼTN����q=Fs8�LX_"?s�7ܕ�#�۰1.��h�b��$�[�C3������]�gC��>W��G�9���̶@�X�!�x��9hq�6�7B�-�-	yW��P����J4�N%8I�bZ�o��*��
@0�8\��'�D*Ȑ�\�������6<0�fLE���.L��G-�	����E�=�RK���E��O4���2~M7��,X�A)���]�x���{'b��1�U<O�*�\L#�F����d:r�A�X2L�1�SO�[Zwϯ���H&�b4�LbRj���+^B����6�T��=�w���� q������R�\�Ѽ�*;)�մ�I���U��Q�*����<��<�S�%a� ���B����X��azj��6�`3����
��A4P���=����{tR9q�"�)Iy��;/��50�)n� �3c�^n��D$��׮:����#�Ƚ�>\�.cf��aaG�� f�Nɫ9�j�p��lrJJJ�3j����A2b�i8Τ�#���?��ζ�#t�g�hsX+���l��U��G���}v�E�E��+�����Q��,�ޫ8����=�@?eR0�v8��<e�7�t'�Lp-/W�lq������R�ƽNȢ�X��V��ヾ(n����G��]/�26���|��������m?���O�����?\��rvJA����3H����}fc�T����Z��w__$����aw����,ej��-[*zEn�	�kz�T�bn�k�t5{��\<�t.��/�5��hN����ڱ�p׬��}�Cb_���͕���.A��~ɜ���.l�,"�kc?���mx��zK��N#ʒ_��{;��jP$5ǏQ��-�f��]��}a���۫�����-`'L��O&Ҽ���O�'��l�����dp��?��k�Y:�2������p*S/����(�W^T`D%�V~�ۻ�7x�N���u��ͤQ�qc�b���i��ɤ����$��b6���W�0t��-�"�lM������Њ�]�b�H%��!�%�(��k��e���7��_�v�-�CO�N�ɩ���X,�ϩ2�Ə��gh�ﰾL8-t7nՆ!S�f�p�/�6��ߞ�$�6�oE�������,uq��^��.T(Kb���)�捰�<��A��!��SR��S]���A���s�g��iF���L��q3�Y�۾]�Y�����va 
$5e���{�ދ�\��VU���ƻn�ԋ�9�V��z��ܗ�W�>Gu[��r:�>uIdX4"�?5��b,d^��M�@���5���'�%\� �G�טS�΍����(C�#0�;��yu?������Td
���LN��
,"��;�P�O7&)�m�΅���I�԰$j�v����N�E�/�*�Ƅy�z�H���ሸ���0�|�
V�Ե8�;���:�9�h�t9��]%��u�2Q���o{�\,��4�ys-�ngH0���u����x)9g�������ѥ]DvE��Nc}z���^m�-wIVv���Ai"7�n��O�9�@�9��i��؞uzb6C%�F`jRq{PЂ=�j���D��Z���h�P�um�9����H���{/r��Deڲ��h�0ѻρw-��+V0'�w0���h�o@��n��A{ZKj��9@�{��OP��bWx��Jy�2\��U�Eᢃ4���H)�.�N���x� ��wP�<�vH���E����D�!T���ȹ� �[���y���,���m�B��]�ӳ��j����H�z	q�\v�\;ݯ���@:�9����Dg����Ӝ ��c����ww��
L� �YYa��邃~�sqy�J���ʨaܬ'���X�Z藝w�1��>b8.�m��0��_2Y��t�%<K��̍+o^�P�W  >�Ӽo}��\�s?���<���+;o�y{�S(F�^���7��>���D������q�[����/��	�����7Cd!��(��n��m�=���Ui&?Z�a�5R�`A;]�G6�d7������ M��s�j4��y�k���R�M�_҃D!<h1��>��]R;��� � �Ҏ5����z�~�O��M�B��x�����f��D���ܗ!%7Y4�����S�ݕ�$qg�+z䯣��r�ت�@d��+%ɲ�dN�4���7q>�/�|�#���v�q�!-Sl���"��@����pN�	���KI$U�N+�f'r���0sN|�*@��x�tN�����Լ�m=Xci40�آl��-|�>ǃZ�o]�����6	q�k�xFzFG7�}ME�d�vm�Ũ}����c���c��k/}0p�K�F���x���'�[3�J�
���/�j��0�
/�Ʃ��(�V@(P͓�������".�%��k��h�4�gx���i�拝��J�)��&�GM}m�l����!P�1 �� �<b�Bc��mR�u$�kv2V���u[��8��*&���b(5W�� {�� �hpG'"^�_4t��u]v����>	WM��Q��j�����f4�}�Vqb���(+K+P�D�m�����l)�{��%	!��Dܗ�n�A�W�9;����UI](e�������x6�\��b��z���]�aa��{E�ݑ��+��\���J�2N�rR��~KK�	�ù}h�h����lt.��g8z�7ZV��/72Rn��vw5��
z�ɣ�|䟅�:k�"͉�(Jhb�.(ܥ/VL��
t�Iǯ:r�w� �įDw�`�+���UWR�K����ca:�I�]-L���Frp�1�0 �#e
��ҳ)8��Ȗ���R<Y}T�8�{I�YuH���h�Q�q*M������A�~.{s�K^+)�8uz"��oR�6����`�f�����~���\z#��'E��(8\L7+&��hӓ�����=�D)�e�)"ѼG�|BZ�/Qb��wZX?�$nHx�׃t��K`��9>t��w�~<b{�ߙ�_T�/�����O�� ��H�eI��LQB��@���6f�X��ͤ�t�(�1g�{:��{V�0����������%�n�Li����8Ԓ��>iN@�����L5HT�1lD�,��e�|��!�ݶP2��Uo
o��͝��2�LX&�v܅l��bˢ-�	���x�S	qZ�$���q 5�}�y�+\T��k%�nE�(��[ݸ�w��~��^�]?�W�贙�7`K��6*p����� >�V����18�Ł$&v�dE�b����e#�k���n��q��&?�����MtJ �N#+�D�@�|��Y�8h��ݣ����W�ϲ�<S��w��s,��D)Y=�Z�K��� �IQf�V�W�/�b�aO���2Ό���%��� �W��}��78���us��:��T����oÞ�\M�w!�ǽ&>�s�(?d�yߵ���%����O=�F�=�u\Bx�� .�0�S����F��RU'`l�%|6��=a���M�@ ��I`d��]�o8�'���XbF�K[b>��g���G�)~1�ڔ�?,*�Gu�3�9{����5�R�)�}�xɁIF�~T�A|��C�c˨䃽5F6,�[=g�#߄
������}���,6:5��w��~�^�y���N��o�HdQ���e����F^�,t��ci�jN0�ɬ��OԶ�Vi�bꨓ��6���Q�� ���v����k+��Y�yh-���>��혋o���$t��M��#vѮ�&�l�R�w�
o�^x�:�ǽ��[�lզ�PWN�`��_��Y�Ǌ���h� ���b����++3#�;���p�|���}|+	��X��S��d�k�Iwh��Ȫ/�Ð,N�c6���  ��/��묮-�f�cV�6+�ܭ�6,~J���V�(��Gƽ�D��_j,�/�+'�A����=��^Y��֋1����)�`;�K�{'G�9��#J�ር�~����a]�ܴ��Lh�"�	�T�����=*� ���[�X�s^O�i�G�Pd��\O�}'��������R�=%
ڲ�q�\^&i1��4ҡ=ֶr+���zr����}�>}5�����^���x=	RO��f�����cQ��.Z� QŦjA	�%�­�����������"e5U�!+q4�7L��mB�I�Rb�ҁ1.�ٮ$�'_�t��]hG/f'ux\�!vr�D���섢���B�"�y�0�ӟ@���6w(��<��muoB�p4s�XRo��_���,
���m�;rN+Iq�4^�v]n�x)zz��	ӵ�ƌ��Vפ��#o癨\Kh�9N��h�
EvrUr

���_�`�����ڌ���\I�^4��C���M�0�y�&���e�`�^ِ+h�3�ҁ䘋6e���J��_�ӉX(�&E�Ϙ�� ���5�X��"fnr��#�o�I�k������P[?C�
�]��ˎ�kK�X5��܆t��y��#����&����璫mbvɹ�>(�����.n���Tzt��X,�ͻP�r�i:e�?�(��{���6�G+�bw��~���_�y�i@J7�mͩ��[�V7K���q�,#2��,�2�Yw�i@ׁX��$ȡ�k���N#v��;p'
*��+�T�_��(C�@�f�{fU��S�Q��v�~����^+�<q�rP�J�u��-�i �~/�>["7�Ϣo3�@f;ˏWi��r��W��+�)�߅ؤ������6�=��3M]�g��銴�\>;��
�tM�@��y���S�˵L$���Ś��,!�z�/��s���p�dl��eM�{�9HG/ع�f�hbk$�2����7O�����Υx9�pejL
�?qiU���XS�+�V���0�@�o�B2�#3	��ֿ�Xu^Q���c�U�o�b�6_��-���(����u���8F�� ڣ�͍�BNR���h��+L6qr��)}~��+B=�Ÿ$&���w�F���*���m�N�Dl�K-�Y9�-�WY����t�;���&���M��}\јԵ��X�p��Tz}�\����]��G�kw�}��e�����#�g���~Co5� �{��Zt�*���3��m3�Vʻ ^�|7��L�=_oŜ��"�G�os��Wn�|@�J_1���Q���.u��!�Q�  ��^:>K~��dl@�Z%���t�)AR�;��	�_�X�*}���B����(��a��!��0m47Z�`!������n�?���+J�׋�c��4!�6A��*P{K<t��Ű�2r��ώ��B|0A-e��z�Dw�,lύ��מ�y	���-j�e���>�$�����}܆:|V�Û��͇���F��rG��H���L�yN3e���3�]��j%Lw�^�ʡ[xš�w�#<�M?�U؅�(�PiY➨ŋ��O�y\�ś�^Eyz���V���qn܁q��� ��:�]�9�Y�i��UZ<ZpD0�,�86aL�IR�q�qT�����?�|���Ӳ�c!(,��#�I=��#������;(E�F1ϕ��s3����Kt;����7�+����sdxJ\K�
I-��[� T�P�q������I��xh�X�[��wQ�Q��X��/?#<��x�b��<^}#DCįe���χ�&-�e���Ia0YI�K�H��hX �i�+��,E�����T{���E)�𳾤|8Վs��s�Գ�-��S8wvW {����_o�HY���"�r�F�W�w��vEB�&>��$��C�3Z�<F
��NV��6�Q�|��z���B�O�c���y����2`T�"C�L�[x�jT��{�+|+ �;T�����ۛ�!/�N�<Ն�u�a�s�4������0)�~h���ؕ�.�S�b�Os��5�����[���\�"���,'Ƚ'�9�EI�����̈́��Z�2\�|�I��~�aס6��

�GXL����Mw8�g��� xy��� � �*���CB��D{[9k�o)�az}l�5p¾N.��م#�|�\6�PT>���AB1%ܾ�Tq���� �?w��3��r����xN�f�qM�>���e��~��=E��3B��Qi��%�"'@��CvxI��'��ѤY�j`%�ѿ�H�Mcc�H��ק������?<�Q��*J=�\��0]�����-^������Ac@�i�����܍��Q��$ۻ\]	�0|��Ħ�]W��x�?=� �r��{89vy+xتi�DyU���[��)����c�|�^T��2.䏠K�0q=�� ��uQ���#1*�� #	횴��,�;�\6�#} .���\��}�\ط�,̑�,���Ċ�`�|*:L͆2~�E�J���W�-��x�U��I�����ǂ��=���N�� �ظP�c�~`ˆ(;��
�ֈ2E;�
�ُIۍ������ B$_���L8�N���zL��2�w�Q��ڲ2T�k��,�UN����I0{=wMc�C��UV*����0\�fH��3�=��s�[������y���5�Å@!J�/�FbL)/9#�|������z�)�d���!��E(��d%upL��|��o�p��|n��
ω��EtډAf�w��u������~Т���x��t�������2 Q�����`�Ir�X�.��9@g����D��_W	%?�6�}5��A���^�ֿ����괘U ���.�	*����X`���q�����"��%�H��T4��篌6e�'�Od�?��lm?�	�k'���G֤���g�Cִ��jV	v�"�{�C%ا��M�(qD%8���f�ޥܳ��r�s�#њY�iN5X�^�z:�ϥ�{fޭ�� ��Fz��^(���HMp9`HdKD��.4?��?b��Hr��0��
�<�~	��&���@�qo��"�h��`��k�U�1υ�/cs�g܅�k)���.��l�\D����J�e����z%(K��㯅����y)�;Sa�����#w���|��2�@K�����(.�LW.�s,s����!-4r����Ρ���ww�ڿ)���^�X�V{�5�}��R�+��O�Sb��P�B�����r�>G\[	s��MVM�b���J��U=���f����[ �x�fv�����yq2��=R��&�gl �����8�K���Ա����w���&�,�4ʚ�Y"�j�a�.{��f�/��I&"����м���v�ʱ>�k��V��;g�V���y�}^����h��cd����HM��&z\�ё0����%q�n\{]x*�#�ϥv�O\����ٔ�#9)���-�#l�+z4����Z�m9h��5���*��p�ƴiT���)��'�9ֻ}sg7	3�k�K��4�x���%��D��r��U��H�W��J�ύF��b���\��v��2��>��� ��V2)�d�c�C�m�B$bm��I���,.�� rnњ����J��	����y9-�6T�ٞ]uY��;���-���i����޶�Z��3��WH�A["�YI|�%Q.q�ԇ�Z
Y���k2E.v��EQ\��������QΩ�}��h��1��#U�64����9_��0��H�λ�-?7�!���qe[U�e》����}*t�#�b>��Чo����~_.5�蕬�ɼ��9�|{�-<$�Vq��km�Y4�&ǲ��ҹ�^^�s�l&<���n�J�� æ3��p�»0��T����9�ě��I|����H!U��N|��J�l���[�+n��jUU^V(�?�ℝ)U��
�}Ot=O�V0��=W���z�ڷ���M�@F}�~�6ꘜrΩLD���f�B�0�.�M�_e��Ȓ�*$r׌�-��a 8�:���Ud4k�æ��>ͯ�h��ch;?��?�*�V'���"�R�O fz�S���lhw�!~FX��`l���
�Ɛ�Ǥ��-�R��v@Fbm�!ê.���U�̃�4p���9^#���);����nh�Zy)�ec
��4ɽ�뷙	/�=d�01%�V�"3Գ��`�=0!����UJ��.f_�Д*���۠��K!aJ)���@*lӭ���~�L�-v�/k_��T��H����<��N0�_'z$Y�FOW��l_�H"�q�,�R�T'! D���,�/�ξ.�,�$��� 	��/;�)����<���7���c��/����cT�8c�0�����։Io`�H�7�Q���n���8�Z��E�y��g+��k�X�y25ޝpbF�5��VNr�!dKJd����#i���$�97��Ƞ���pK;m�/��~s�tl��y�2�s�C��;�+��|?�F+݉���5����G�YQ�vj��Q;ws5E׊VWf�G�~0,��n���F�?_)�?4���_pX��.HK��i,��mGh�G+Tm�"��*�:^��G+�Nȟ���!
g�w�<�}�����bs��ѩ�J��ƪڼ�`t�\y�@Qi~�ɗ!����OR��cznRj�萵�Mb4했Ղ�K����d�="&����a��9�*�fRs#��#�����o�(�Ѳ!׊A,E�׼�Tf�h�G�Q�%����k	'b,����3�=Nr/�|���m�v<�ç�p�'vK1P��=�Iܨ�	e�)~�p�Z�j�G߲�o��+�=@1����"�f�b>umX����v��6Mo��
�XP��PWGU�[~͎|�����byJ�h��˂(�]�G���sY}����o�6��vǚʁ�1�ܛ��W��1z�щ��2�<m֊�����oj�/�C���� �6{>}�������=��"�B;���BS��x4>���r�$Y �@u��W O��A�ߚ���@ :� ��;�p�����V���C�}��b�'�6W�w��j5�	��4S����q��,@�����4���#�SQ	��㓘�4�Csv��
^8�P9�)� �����x^G�Ð:x�ц�6��e�l�N.�ϥ����1��u��pK�D���'G�o 7
��;v�o=�pD�jvj�-��$+mƬ�y7�4{���3J���yC*��:�\Y����#�K���P6Y0�l�i�y�)Z���G�_��x���<e1��L̕Ս.���Fw�E g�)�<j'_�"ע�������	�<�l��b5���)10Fע@��a�7= ۟��v��w��}J�4����4�m��4@��D�I�X�	׍��q\5�����rm��[��в�s��5���n�ҚL*�e�a����o��3;��1��#MY��f�/b��"dg�M`�V�y���l�]<� �>#t�;;)�s/��PA.V�Æ�4��3��˅�,܅n��Ėf�Х�6�]����ȸ��yem��^�[� <��.�(�7���9�5y{�9����\�+,s�{�탁3��K�"�q���;3����;�\��`X���q�ن��@�k��Hf�E�
9��^�?�}af�\���}<�C��,������E�.�W��.�9
l�������B���,I�T\Z��	�=	�Q�/�
�|\o��%B)�J`�?q(��"�s��_1�i�n�e��bPGK'�v�'�b~��|��RY��iI|CZm���>Q�0�)���N��1��Fyqe砈��aSAa�o�e����'F�a�M�G�u@h̽;>n���q8mx|ʦri_��KQ���O�G�y�G�@��cPr�ߔ�F�� �7�eVm[��2Q�U>��
���Y���� q�'[���w��˞?^�/vSە��?��ۿ�#4[R@v�Y~ʳ���n�v�y����G�N�BL���8c��L�_
h�O�����M6ՖIÞ����'��ӖL�3�ͯu_�4�NԴgYih��/8k�Pί���s'�>��v���S�2N�u�+S�-]��	�^iR�;ґ���D��5o��4!�/l[I.�\dY���K770�]�$�/��Q���G�<����HR��J���2�Q��C�%(��=��-�O����������_X)9��F�Gb���B���(YG�%�=$�lU=O�.�1�`�@q��r�x���w*{��M�؎1�(�ق����Yn2��-�?�������T�<(�bd�SM�t�=��5�9������h)��K�dF��+�(A��f���.��r��i��%��v��l��eX��=��kbQU��j�-dd��h�Źc��J=�`q�9�j�Z(�IҠe��LlAs�C_&��qz�RT�y|�7@��N%a$�m����Ln��G,���S��s/�j�H��
q$���<]�ۆ�Q��-SzSZS�pR�
�,�+����PY'�Մ�qX@y��Bɼw��E%H�4��
�I����i۸����s3qo
_c��	!V�)�A�F1�L�K^�L�o�K}
M����C������]��(�I	-�jL}᪽�hP��o���y�qc�3{��l�<r���IF1�J�Q5��Ix#�u���h����W6��G�����cȣ��o �z�@��$w�����dtw�)8:Ƿ��v}¯�� c����*��-�`�����uSɽٷ�y:j#E��y�Y���s%uV��	i��L\�x)~4 ��#r�
��� �wԣQ��ܫ�|��H��~��x��:��&���Չ�(����%Nq��h���U)�L���lǒ�(����m(�{�WJ����bS��ԧ�j�'9:���J��kH�?g��Tz��V��@�* ��(+?M�(�f��S�"F�[t�0�r�c�G}�윃��9�Kh�����?G��iZ{#V!�b�:C2�ńxj!�Q����ԅ�Pq���r��,��1v��-J=�m\Bű���>k�g��Pӂ��eq��/���I
��x�u��3"a�UI�;2VLp�5e�a�5���ݚ���1 PW�#k�)�	���؝�B�p�|}{� ���Q٪��a�ZrY�;�NB�ɏQ�>��)��2�`�"������Cj���K{(cb �U���5_�CF� ��w�M����m���Κ��̜M��| ���-.��Pږh�6�8��m��5z��}>���fn�fV�U j�b/q�]!!i|;'+
����D�{ҪdJ�|��oZ��bh�����,G�A�	i;�
l�8Z�W�}�QH<h�3id�8oC�ु����!@D���l�ww�m�;t|o��ݍ�N?�W�Në��ݩ�!�D������=�R��ӥG��c�j�`꠪�)�:�ܩ+34����R�J=~�QP��W��m�[{�\�V����;yxF��Bj�r�q�L��1y���ToC�vh<�'��K)3�CkB(�\i��3nG�n��iT�P����2���nTX�l��`�$��-�y?��k��iR��*຿�(3ړ�J��7j���
��*�^�$r�~Y���f��fK��Z���) A����ܽN�AM?��:����&�,9V��@K7$��2��K29���I4���f�$y��R'�m#f*�$nշ���ά�!����A?��A8�"�-/cu��4�N��K��Xy����MI���Tgw��],��.J������q�bC��&�;u�C��m��^�C��
���
e^�����%���L�]"����I�x��A7�1P@V)OZd¸�YѾaV�T{66?���p�,�hY�q�s������2{�{�YV��-��j�2��Q��,lo/NAW/�Z����x�w�����6�ꅺ^rd|������'�7,���� ��@�A�Dk���?�fR�O� �x]��n��v��#{z���1�꣘��ѽH�FҚ4Ɗ�8T9�fV-���e"z��	�n�b3��K&-{4�{����<���͏��3�1�J^rz�:�����V�����S�xx�749��X� �?C.5�ZB2�p�pK���;���|�3$���4�(����s�:����zeϨ�֎P�(�����DV�V~%�<�=�I�3�A:�]�l����:�5-m�>G��GD��w/��i5R���~�u��<l�j�	�n/"�(3��a�0!�#pkЄ�������ft�Vq�v�'�I�5�����X|�ך>G]�`��H�0�[������E�vQ�W�&4EhA���J�!�"��G���?F,	�^k���ܼ�E�ҵWA��0@���Y��l`9D�]"�?�:� Q��oA��d���EVo�Ab�s���K<�W��� -BX���t=l�%}�Ԅb�UM �Ls��B+>2����@=�a�1��Iv�m�MT�n�>���_:$�L<����̙>#���r`��ks��^����V	�*{O�%(�s��M{e�nE�3}�8̕7t��oZ=.Q*�����������%C�'V�yeH�f�S++�K�2���R��}�X$��+o�xE�����Ԗ�@�V��6ޞ�ANѷ$Z a�S��3�2��չh�2A8��Ȏ�.;�������m���&������R�d����L�	oB����J�7��#,��U*!)��M��:iy��-W�WWщY�.�������[�<2��t�qg�3<P�˒�ݣ�J�;Z߬CPv��a�;J�s���ޣ[p5-|�X�%�X����r����sb� �,�) g�}���0���.�x�b���`���\��1Y줾�j�ht�$�(@an�X9��au������a��9j�&g/t��]
����pX� �H�����Q���M���Q����`rǩ�$$�$`,ŕ@���W��W'����_��0D�{�[d3�C�Ӄǒ�u��R\H��TL��fKmNc���-�S� �[٭���Õ�"nud=���keΡ���s�҃���'TM�@�c�4��a��s�@�bV7��>З���s��dM����n6�V1���TY�O��SpO}����2�|�k���-��{���!i�y?��aJn)[�-��N��H� �_�v��{������O�eF�ɴ�I5`ϭ
`F�֗����IA������s�G��M��j '+Jp�~��)Z�mճQ�6Ir��x��6��Z�}�/��6"��梖���j��_P�&F��� ��p� ������{r��	��Ò? H|ܘt3����^7w8�tY��>u0�%�Ԗ9��@4Ҁ��SWcl8�ng�Uܶ��!.X	����������88�gfc�j,%�*� �{5b�|�d�c��y�����ٵ�$�v��;n�]���_%��:�O���DuQ�/n� �J�oX�Or9�v�5j2�m����;����Yl�95�cD��f�8�U�Ɵ��h�30�@�%����4롤;=>|�]���^/E�}����'{Ol��<��
���
�����j���h�N=Y	O��mk��^����u�����?��H��bN)5@"��-8�9�KtB��P��eD>����h���PT���sC��(�5�
���P��u-_;\X�ڪ���A��J���aчf�<]�fc�Q��J/��"��jǨ�NoS<3�w�T�#KŔ��E�&��F@�2;����c����%�W�Jg�G3J7���ʇ�K~ԩ�_���w��v�;�2����1�؛�.a6�	=	&�q��� ��;�<��j���ݖ�z��Jn���ܬ�1G�pc;յ�f�f�FAl\˷��y��n �S�4����5K�)`TB&�^?�_����$U �\/��K6'�zu��˔����m]�ݚ��8jȂS{O�'Q�������G$�P ���D���Nd��ޘj������̻�?SG���|�%�3\旋Z=;�V��W�$��W��My���>Q�T��?���8Ι�K��>0 Qx�A�#�g+�1+�Vr�.�Q^k��6c^ƙ�l?n޹��_O�aC_[?н�L`*ӒK\p
��0��1ډ[��T9B-��-&�G�jk#ε 86�C��r�;[���lo��N7��8.wq�ޓ�V��C�P1�i��>}}w =��蔖A����[R�Ԧ�0�q�S��N�f�&u�LmB����GP_�R���x|G�Νw��)md���e�=�TH�e{��9X��٘Z��3y��(��x�ӧ�KFu�nIC��-ӜtP�CɄ�nhb�>�}Qz��H����D���5S��uß��.GL{�N�ߞ�J�K�W������Ha ��a�a�������}}3�h<�}i m���ͬN�T�"*��zDi����?a��������$���(�pk��V��<�Μ��Mb�n5jX`o�� �n�M�2n��s5�P~ɣ��O�W�T3�UI�KN�mUͮ�<lÐ�f�/��Ɣ���Y�����L�Sm�f�x,;Uf.͒����_��^��̜tEɊq��g+g��g�o�Y�([�A3��qpw*�R��H�[��@�w�3Fqk�y��!�K��W��MX�j'1rTu��gU��	m�Rb)�~�Q+�@m��6���W�F{ߤ>\M���==;@��"�?���˦�Tv�g��?~��G��|�����v�.ZY��^�U�x�Һ�?�7��A����+gW�n��Z��f�j�6�|
�$��t��[�����!��v�rA[���n
�G��c�[�ߤ��ǐ5+Ov*{�t`��lR/���RZ$?�	�X�8�*t{�t�A��~�[v�_ IJ���3���N�KX�p�.rζ�dTfs0��[O�`�o����~)}�օދ=��ǣ��\�����.M��k�E�<�p��'L�� U)�Q¸��ܹ �Y׀�jkꭺ����5s� ��sG��c�c[����메,�����d���H*�P
����B�;|ƽ���eud�Ah��0ω\�7�0%��A;"�� �H<�`IZw�O����`��J���=���e�(:��7����c/-��)m� b��o�J+ �n�OF�)�Ra�q����EH\%�������z\�2�2:	f+m}�'U�����n�,�8�,����,;�D�2�.��_5�+��x6�GMA���*��b ��w�t�5��s�[?S�Y���e��Ů����`P�Ē9¦�,0,���T���~���g@�s����l_|Ta��Qq =�Vz
�JR�53�O�B�	���4���fq�Ԭto�}�!ٷ�WժW D5E����G�x�E����E�#�ΐ`t��C�NI)�qgeg�6>>�D��r�	,�)U���P�S����f�W����K����.u`����@��h�(�D�G�q�h
a��
�T}i6���
�c���ߛ�X�| �h�4#�:�r ������x�Y��L5�,�����>PL\��;;� fc�4ǁ0qG��7�m�=��y9�s�4�n��*tAf��x����!��y= ��Ӹ�u�7�B��l��o��˜��ABx`2�R� M�v��'��8U�u�ͥ�թ$m����ȋW�АZ�}�E��G���d:l��ܹ�����a��M
C��[��išv��f�e��4����.k%��JDv\N.��#��B�6.�$�7��dF1j��~�Q<���]j�j��oTOʥc�J��+������<@v�d��8j��,`�w�:�<Wq��[Äp!�AQ��b�5���ml�T��S5���H��C+~�!dj�������g���|�`ْ'p�&k��I�*���XB�����{�[~^ij�v�B�}F�VE��^.Y�~o�e�/:L�B�f�_��j~�Yc:^������#�e�|�@z�����d�x�`�6y�6Q�:A6|"2@��b�T v1�3D�t��/��q��T�`��G���ÀV�&�ob��[*��W�yW���a����³ɗ�@��䗀��t��+z0�,��ͪ:�5i���m6��1��I�0�8���[��O��F@N���,���˂����b���m(Ȫ�:(�i]j�&�^�),�`?��p��s�BT����juLߖ�Ǻ�z�+\B�
��*+6nQs�@�
0��ȁHL$�F}?�D�f9����ّ!<'��\��^I�TZ�����k��&w]Sr�f��3p���P��*���W_b�B��j �Wv�ʊ�H��B�+��At�p��ʫwն�{�  ��t6V˪�/'e���/l����֏�sG-T�a� �	f	$"�w?̞; /�����h��:���p���TI9 ��R�t�&~�����:yJf�[�e�OvIPG`v���f�VȦ��/���m��4%cNO����V;��c�T����ve�>���y����S�&��{�"� |��n��@j�[��0�z�|(�����ğ~�>+=a�(p�?ݳ�I�����V���CeL�~@𺎐�Y�'O��n���?���
:#v���Y �Cj
L,B)[�x[�1�j��g��ʔ��M ��7���	e� ��q�����gxR5ۅyR�3�ʛ�0�'9~+�m�qem�ALj�Nfڎ��x����R5o����"��ۿ���G�d���u���.?:p��5��9�2�`�2�S��h99�v&�`�}���@�x���R?a�*d�_�C�lL�WN��Տ�ſ_�������g=,��,�"����i���8`�ؔu	 �QG���,M�!ơ�C��܏2-�^�R�Z����z�u��C����e��tpkE���� �fn׷}�fl����ը;g�
�l�����ћ����k���!t}���U�4�����g���4	���^(����]g�G��A���tc������/��E������5���i��k;�6˞t��6oO�;r���E�<"Β�i;s�뺠ŀ��_8̬�#��@�~E��wxYR_��?)��*4��������5
��@��8+��6Z
q����V��Dx�{H�=���8I�S��9����}�9�z-�s��p2-e�dW�jo���U�@�Y?�yܵ8��<�t��۹+$9��-�����S�jM�~��/wXxkԴ���]�T�|��YK�\X���	�l�Ez��dꁨ������^G ny��ҟh7�g�ًar��e�/���-�Y�Q�ޕ�q=�u	3Ĥ���2`��#�]���kǬ:�/K�Y/�A߰,��ߜYkT~F:Y\��q�l�0��(N��ޙ~���^�_F�n��ӌ
�LA���I!=���r �bY��P��?��P]4_,F9�-�l����9Y�WS�����㫠ګ�}��`�����DR���[�L�UT�� g���L>�6�sH\u�z/ՠ�,L.�k�tE@"AY^f��a�e���=�M)�(㠏"�{o-D�g�	���J�1�R�%:�_���o&�]���ff2�F��>V_�W�Ur�Z��޳t��O n�|BxZkA[��mv>hY�a�g�vNܛ76���̰�bH�b3�#&�Z�.�ٔIt]
3���u�g�s7�#�����^~�c��Fv�j��Y�.N��d�6gE.]�2��/?�L&Y���٧�j(;aj�d<��>G����m+M�$�@U��2����h��w�J�(����B��Y���/�E�
e�פ�M�w���S� �T�s7I����'Z��d���=8o�`�j���j_�Y(�#<�@��T�'����{,'Ch35i�:�^=�?�k�}z@��n�O�co��[`�BSm���WJ��2p%��RL��p�י8'B7J���;�<3S� 8��JRǌ�9��!E�X�c��s����6�)#�Td,5�>�~ �s"ax0�o�
�%��Ֆ� �!͸|���nb�&�G�v�*��v
�d�O�rV���`�<�j4�D��/�_V��h�:�ӛl��G]��O��8�p�\�f� ��Y�n������� 3���N�k���N��� B�oMv��=T\�O1LD�"��o��a{�e૯�d)o��n9�S�I�SLa�m�aJ.6
ٛO�#b�\��(�h5��9hi����L_���e��{X�+Ԋ�/��Y��F��g�vF�ߌY_.P%Z��T�_~,�b�}��,�cUm���69ɅX��r��?.z~�Q+�p�N�����κ�S>�x�s�
��:v��X��a�${{+���}D���Z���_�*ʱ�{7�8>�`(�!��R�B0�]%<L�c�I�s���dR��+�x{"�)����C�\����π�9���RL`w"����=m�6Z��%��� �#�<]u�hWA@�Ӭ l#nD`}c�@�rD������/���i������`��	aT�ˑ2�r����y���5�{
�{oF]��A���8t����%6P);��B�f�B!٠����jPt�u��fZ��mB`]g�CB���z�1��NԩB��s?��&8��1�MY��4��n�H|��t����X�=�B��Mu~����e(5R̈,�OBb���%�#���b#=y�� q`�V�O�[��6�9g��$0\�}��Yh�,N���J�qc��9i摀�r�!�<�8%6C�ւxT�>��ĝ�rd!��Q'�U�>�q����m���HȂ��uC�,��b��l������D� ��>�z*5]��o������;q��|[	�! Rv���8E�K>�_ø���"a���[DTS ����R�?�+�_�K��"��ͯ��CږZ�ު��Ary�1^��;[�]c�0�|S��5�M�y�]�I�7�١iv:7�b(��K��'1/E�k%�}}���_cA��fব��:�ٽn����ҀE4����P�S<)���r��d��ZO��hX��3�:m�Q$k`ڗ��ؑqX����l8@���.&Od���ܳ�ʮ���6��b+�Tg�W\�l��r�VO�ݵ�8E��Y�`�s�&lR��0t܃V��}e��6����g3�<*�)�,�c��s9$m���������,@�@WB)t���
9f(�"�\�1ت��~�q�H�,H��{Ӆ�[�E���z21Y����e�Pqt#!�ɚ$�Bd婲tR��F�Ne�R�jqh�3#^�)v���i��@�:.���R��ڪ|�:-��?+�xT��7��5��Ol��~������:q�t��78�9��CI0�d�:��V����������1�n�I�*C$�Ԃw.ץ�u#}�!�|ɯ��f�=�+�u�ǎV$�T�ڎ���]��tR<���W��xj3�H�����2KK	�a9�,��sl�S;��`� ��_Rb��d2�̳.��/�)c�*�Մ��9'慢�f��UՄ	C�ڙK��7� ��aM�c�ij�Ucq7/�djR�zMР
}�	uG�I��e��fr�G
�>:��6l۩Dut�d�ʶW����0fɏG2��\k�:]����|N�ko����ꂱlٵ3q���Z�m0�\-�Ҫ��Z1��iS�c��|�|�+��t�:��]m]˵_��FA�N��.���i��첿�41�v�z?
}�pI��o����x	=����V���9ٞq��k����DZJ�œ��9\ʨ4&#�8':=���Y翴&�}������RR�hE��κ���MI�%��� ALz9�'����}�F!ZL)�:4Ŏg�Y��Q"6�UV�_:Z�7�<|u2�0��pn*�n�B�f���{�t�!�@�p���D�ָwsx~1����sw��C�6SIm�Z8չ����{~���C[��Y脤��,6T7QO��by/�@�y˃�@l��ȸ�����|�8����ث������f�4wMCx?���Qm�i=h�����aEt�l�����l���Iږn7�E�`�P�l4�F��݅����ர�^�FCвa���'���Kɼ���K���Zj�v���%v�s�1�c���$H9˗�p��Kx�ǎ���H(������K�3��;���^~�R�*U��/��C-"��â[���Sʰ�����%Y���~PNd�/d������|v�q@�26�j^{W@��h�X?��4�_t�g\��5��Λ߬�Rr�Ci�G�@c˔��G��8�e�˦�+T&�{�2=l/��C�6���Hhcu��]ӭe�He����	d=d����I�׵�ma�G�8$ܫ8G$2F�[��)���Rq��ߝ}�T�CھTL�8y�&��ʵ���a���ߕ�t�p�o
/_��d�i�M��[�juنmE��#�l��L�_��e� ������%w�x;C�0��P`~2����z���A�w�L@���!�>J���W�o�~mD��IĦo���ŷ9r�𬩉�������)O���WHsRL�G��/=���(��M9~B�v�0=�q���t��m��������F4��z=	;���n�W)hR�n��|���h������]��|S@rxv� j~ebЏ���׻u��Ssc�
��X5.G}6x�}�ëD��uZ�@$3�zr ����
c�<T9l����?��Z��6̴�x�N+�±�/ˏ��G�_��!8��
���D�w��|~�VPC�ZZ��g�
 �i�^�D&�SԻ2�]�b�1G��+_�BS9�S�nϷ��,��@L �/8F?�x��@ɉ�)��>�қ�\؟��e���X����f�Z�F}2��L
'� q�DO>Rۍ�ۺ,��G�@�0!MZj��mz�=aPi����yp�Z:�{��]�z���l����>*��^0J�����a��X]��=�~��~3_��e�o5��G�=|���=��q:B�Fwm�`h��&'��
�Z�lؠ�*�+�����ܛ:�P1�x`z؋歄�{�ʑ�lt]�H.Lm��U9/��O�M������5C� �hZ��-?���T��u��a�� P{���9����`&��G���I5`��F��<h��� FGX��nhI�Dx��ep ����.���=�J�S�{`�e!�FX[m�.�O>G���'��F�����b�dw/�N
��:"��*P(h%���c��j�U���(o���,�GA6pɍ��6L.�d���TtM�!er����ãa���P*��	����u[��-3�T%��o�W�D�AZ�W��|ufB�:⦒!�jl� i6�gG����c���5)6H�m�����y�y�D{��M��`)�&y{5����Q-�ioz�>e��+��pNb�U��;=�y��9�,o��k-f�JєZטV��b��b�����r����� .�ű�?�K+
�?���?��
�r璢�qC/��M��TQG*�N��˽��m5S��L�:�BE�m\ 6&�n1Ur.�k����DhB�#�ɆFx`���	Ji� ��ž+�x��U$!C8n�y݊j)�m1���x�fu�u��9��*�� o!�`u0��)�z�(�j��	E���g��b�"3����W����p\���)N�L�bO֟|�XVG�N�
�Qď��țo`�"�-��D��isg��Y�Ŭҭ����1��n�`��L5F�4ʐi�L\l��sP骞w�j���6W Dȋa��P���|�e��T�U~����-R/���{��5O��M�%��;�3�;A�1�P!��E� �J���k5f;ir���	�Sw&�i�ZEu�`�%q���V���R7��]�߀��&����r}x� VQ?��gš�c��Q�b	�/&$|g/�8*8��L�j�����Ro���p��"M\���>����%'T��x�3��2-�.iA
*�B����,�me%@
�D�(�����D��v��b@P��o'�~�_;�.�$�2�ϕw��;�Y�qX�� �q<ؐ���Ҥ�ZN2�.��.Л9AcT��%�+�����]���v�
�W���f+��j�]�r�#��#c9i'%\Ԙr'е���wojy�eq'�m�=��k�%Зi�ɖ�I4��ĤK��մR�'���RĤ������T���Jq�9�@�����b��3\4��Z$L��#�U�tA�4.��$`���Ж�I�I�Cdyt�%�q,�,]	pj���k�C�T��~��� ��d��5�B/�K p~�na�����g�H^���b^+�J�Q ���Bfn0�� �Fm8F�8]��QD��e���u	�`��2�9tNs�=P���)H�?�J����ET3r�&-E�� ~��X�����!���_]�3���!�q����ɣ0r�8���~�w#;C���&b��m��JO�p��D�ghE��;�|�@%]~/Q�ߋZ�
׀[�+����o�/sg+��mt�`��<�RC�����b�e �ָ`���W{f!	��Yz�n�����#��m���A�B8��J�CE�Pv��j��1��������ް�,A�E�[�<��ъ�)Yc2��h�}��[����㚲�o�/���_��RQL��h�RXX�]��*6�4�9�Sf�/��7�CM�<�d��Rb�2,�}�[�|Z-��aZ(�HO�����10�K��x����Z��QIdD~�w6n`t��V��&L�|�j���}��0���T��>���ܛNbX��6��*�x��R �����c����G�T-{k,��KZW	*i�FX�4�x��]{�b욒��%J�m5����"�u��UY����ń��b�Kޤ��I��^����kRp�B�M��AŤ�RJ�	f�Ӭm��*���I;|u ���[!�:���.�{kl�0��ֹruT'p�;.�S�,���Y�T��Oy
F�Cڍ��J��<�и��|�G�G(J����B�(��*�ǟ ��1Ib������-��Ʌ]�'gHl����}�#f04h2��.e��Ik�x�8'i��8���v�WZ��񦨲OLF���2Ǯ����P~6����#��V$��S�I4r�mIb���Ͻ<��m���S�4L 2��9@oy�6����`U_8�#$���g�C�_Ԑ�e������+�@�#M��R��� ���o!l�?lav�I*D�)؈K70a?9Z�����4RAY�{{tK�}Z�Who�y���d`�鷚"2KԮ���CJ*-X���rtL�����6��6[���ct&P:\���>y��)����I���} q���ik��)3�-��
L��P�J8&��� e+�G�/�At�7�x�e��O5����8T�N[�Os}�Q�7��&�_��@\��2��)�6�h\�י]ť{��:���r�g/X��I����� E��g���觸wl�n���\�7�"� ��x|1-�瘝K�0 �?���k�c`6����'"��3B6��z��kJ��@F�K��+���G��EA�o��?�8j����)��%�8ʷ����}��x^���a�祾��_��BW�GW?�.P�;�ED	3؂,�I[���CE�&0�>]f'i�/!yn��E�ޟ���2d�[4��Rw��!��/^����o�`�_R�ߑW�r�&T�z����I������pi�!�������c�#��6b*n��6a��$�ׇ��C`���?P�-�f7Rd4勂^����~���,ʉ���V�;f�q��	9�M6����_�q{D0�][��%��SטLE��]���-��_�^Q�4�NX�q��}U{�{0��A���Z���Z�=�폒	��`���& ��[^��5���_����?�@p��J\K򽈩E�u,�'TҤ]�A�h����ٓ���
�(���!��EGl��ޢi_F�L���[�b�����H�q�ⱛx�L�	瑊��hɞ�Ǜ!���&9TcBN�[�S�6h�I�B�Ѩz�K3�uH22ʮ����Hؐ2^�y��V������A������0���	�1�~i�"B{�ۆ��^Y��ሙ,��q8��1�I��uy<3Wڛ�5��9D�[R��b4ټ>%����r#��w>��-�)j]t[am78��9��l�x�թ���z��;���XY7uRB�a˼]e�zX����}r/�؆�:ފړ�m}C�\�Le�MG$�$?�۲0l8�2�`2�H(����Bq����7����爵��&!Z"�d6�k����8��V����Ob�h�a!a�p����P�X-�y��S�Y"$�&���]-�m��W��D:��s�<����';�2��ԥ}%Z=B���Z�*��>�Ś��"����$ƌz��P��<%���/�Fgeޤ믮�s�=�h��i�_e�[� \��iP����jh2�˂��>��N�;j7�	�ô��nz�̓P�*t,�#E�F>���bMo@-ܩyDğ #�r��KV�2�WЩ~�@f������)R��0����U�W�v�U؁�Sͩ
�f;q���|�!���E6���Ř	��2R�9TM�ă+��p#?�{�s���Q8��gʮ�vy(�7\��jI�B/.^+ ����T�m��f����\��zq���P��|ԝ�Tߟ�z�7#C���H��P�������Ϣ*>���$�J� 꺊�	�d뭖���J\�O
�����aG��0�;[Q�/�R�D��q� ���n�v{Ϲ��ѻ��|��f��0^����*���őc~�̨|����b����t�P�Q-t�D)yEu���We���e��vˡ��g������7ݼ�A~�!u�o�ș�5-!~� T��o�1��BfS���4���Z&����F�RQD���\{g��f�$�$VdR�x���CH�F��1��y��`,��o�7����tǢ6��˓�->�D��̈́j'ѵ�f"���)�xmz\��@l�oq
��9��TQ .�[cC*P!�o�'����Z�G�"�	o�$vW�j��.���V���ez�)>	5t�}]�q�#�+��|K��/격�}
$k���Vŕ���Ie�D�;����˙7�o�m\h��fd�.4N����o0�{0(���lR�aB"xV!�Ɍ�]Q�y�횦��H"�����Ēe��y�85Je���݉i�Mۇ�J/>�g����Ӡji�{��}ՠ����DU���K��Jʩ�ٜ���xd��e<vK��e�8�| �������j��� +vr����ՈC���X��v�S�;��Uh������D7Y����Rf�6SZ�8�����ù����3�li<2공��9!8�������qe��LW���Vg��ȷ��v��*�����wb��V�-饝O)�dIo��+�$�Ѫ0�$����C��`�/3^W}�(׬��0�H
pF�k+@�����w����ӚMs�GE�f��7��v�E���S�9���
�W�4˙�:/+@�V��{�=VOEe�9�〧,��(?gٴ܏q��]	���7����:A�e�?[�F/[m��Fw5�a�}�tXө�`b��D�1�ar�6���O�^&�AP�jl�sp��c�7x�U|��P�c)�R��3����}(��$�6�i}P���*<����a���W��W$�G������b�C0�o��{�ц�b�G����)Z3��+���4Vox��ˁ��y��@Ļ|�`45�sO��;r-�[� H�H����\h�+�	�X��C����y������퇃�=�N�?N|�^�K��g�#)��4l�"!M�mTJF�S��3+��!ߞ2�zR��*7��d�z����N�Xt���ӛ�n��P�X�4اgu�8=,�����H	F�%*P/��`{�
t[V�P���<�g���>�쑷5+#u� z�[�`{dү6��G�U��q��P\ 8��AtGСr��.��Lu�8R{.�p���d_[�ɵf��sV�����*�_�h�X%�w��wT�	
���̪QK<���]��7p��iv#. s��s�J}�-�]N��JoS�	MB��R�ϳ���i�}�j܆^��1&^��C�mf�����{=���Z$��;[I���r�P�G���>��<�6�;d��;�G�G�iB���^.o��D��"@�H%�]PJA�V'�5z�_�A�|���=b�'i%+4\�����D�d�&���k�c���fj�!ְ��U���K.,ű��F~}b�5��P�f�G�uc�x�[������4��M̸ز�؏!>a���~F���A��c`�>�S�7��^B �?9Uqh���5}ko�m�
ѧ��W����]�:0u��{�7NΞگ$����9.��}ķ��L4��x���ޯ#��99��!�"Ȓ��-2wM7��p0�Ps��l�sKgF�k�]�f\H��m |�d��+�=�����$����:���Vr\�?#�Ǚ�a��7�5�O\ץP�{k�ǂ!�i�PO.;
Rt�"�7��RO��fp�9Z�-�����tߋ�iw� )�r6��`�^��%X�xBI���6��f���WM���`�XҐ���:��͏OŅx�T�:��E��Y�flQЕ�Eq��#�vg�y��k�1�^*q���M��B��e��E4y�ˠ���^L���<>>s��w�3�f�)���g�"lJ ��p�ĆÈH>�XT-��a�҃�r"��t�B>֪�5ܥ���+=�AH7
�l+(A�@��7T��e�$C���8���Yq�]�8h���w������IJ��u8j	�~����f�Ǜ:�MĤ1˥��ݶ!�Q�*b�=�;�&��Z�g�&�9�A&��	�6���j$�Z���A�7�R�O퇪���c�W�"�^��Uԯ�r��\�j�=qJ��wcR�!!N.B֊B�+.�
���(�Aն�9K�m±q�\rHu07\���G��Ӵ�@�����o��	U��h���h��ۓz�e�r����
�&;;3+�0�wKC^>d��?W���,W�lF�ūE�o�m�y�j�i�$����7�0AY�&�,:���:�؀*0��mkY��K���Cr֐X?*��q�(�b��݄�Xa9��R�d��u�Q`l�U�ċ��
*�\���ф=*�?Al��8i�m�2��ۡ���TC]s���Tx'bH��o g�L�x���6�bI�ܗFF�&��h��"��h����zLdG^2�o��LAS�i��s�r���?�D��ν��G�V#9�ř�
?xS�ֈm�a�����K�����0�����-U=-�DkNF(Ɣi`dr��� ����<��r��Tx�6u��_H��V�v�`�<j^���iQ�X@K��訔Ҡ�+;H��;��	�:�H�y�Թ<^{Ǳ�����׎��A�������#F������C�}���h�ɢ���:��t#���	R@^��7V�F�������+�{> ��Zt�O�vީ4np�Ť7�: ��d�>�����ݱ����Au���s��A���]�~�j��
N6��o�,+;���C;�Ϧ�\�4B2��=mn>.h=a������A�^�ʫ�.6�"$�K��"���ML�1R��
f>E�ˋ��D��� ln>�R!�[��gGTǋHR��	��ڗ��bI(�� �fM�!��yÉ�Bp�v.(�����1$�`E���mA}�$���P°�_�_�}]�)��2i��%�����%'ݧX7 �xE=��AV�����j{�>�I��*-zS�on�;�?��m�Q���Bm>T����:<��z�!W�6�D2����q��P�-}���F(/׷��<�Q�M�,r��
,k�CI���I��KG�Lm�� J��"\�m�Э����V]usv�n$X�8Q���>z�]~�G�'��f�������1�������B���G�M��*ˤ���>_��h �R40?����kr��"����a[~���0;)�-2��+u~n��-����qܽ�� �uכ�׍�Vz��^f�����朹��$=>ѱ2����
�����;���^\�)'�����dt�)�E�(�OL�Q���95M$b��>y`ix�}`�]���AT$`g�e��ȮIZuO��q�B��c�qyl�t�$�m%��j���`�=��B��`��;��[4 ��kb�K�ӠWJ�B�fP��A~�X���A-��WÞ�R���HK�w�mC~�cH�]���I��"R�Y�8�O����pO�Xr�C{,v�f�[�����JM�h��Sd�;�7��ި*�i��+���������B�5:�9byMʣ�)a��<y����(�4���q}n�6�T��,��?(�}���qn̿�`�e['A����u�ə�hL��Y��V(����/�KS4���J<��D�F�@��ا���W(��rU���4:H�{̃��֖�s��q8��ӧqq��^MCk��긚92��(Wre����+4*���ˎ~p`{T�gp"+�S]��Y�H,}�ȑ����J�זX�K�	`z����KK�֠�K� ��ꇶ��(�F�-J�	�b�8,g6�Q�%%w;��a�7��?��@���S<�K�FaY�C�5 �bK�_<���P��(��2��73eQ���X�݄W�2Kҍ���,��حo���a�-w������w$.n��	*B��鐠5���
�Q�ҕ:M^���۟l/�͠�n��?Wjlbk�py��N#�u�d�l ���;i��)��i� MUA����
�0���j�Ain�m~��*��+r0�GY�gd�,1��R���`������p_[=�m��j�3�]T��0����x��́r���s���rw{�^��0Wؚ.�gb!1r��&����E(�8����
��9�9��}FbE�����B�Ò��֘-����[ǯQ��)��������{~S��������k��g����J5¥h���f���4|iO&f�N��A5"�Rŭi��jbZ���Bע�e(��������=1�qwr|�������0 ��`�r^SW�v�q�}�q��>�f
c�{O%���	n�4�2�8qUe >�0"ܜx��78@P�K��7
ݫ�,š�����e�A��C׸�C�Y����Җ5j�$�2N���v�"��/S�}iK�P(1!���e�����qe|��4$G$RHdFv1�D�?xٖAp)y�S�z��9�.��( ȸ�enhSi�I�ԛ��h�wsđ(E�w�*�r�]�FZ_C��W��ZU?��Gq�7b4��&�$ �?d���۞�#6,��HG˅:�����$eeȫ1�ͤe��T�/!�!�$5�q�V@$�'�@;y!�<�_�Հ�>��0(���SX�\#F�|��R>	�%���\�b�W�6�EU��,��BX��(��~� �C/a6q;���d�➩S�� ���"��Y�ܑ̘��~��P�4��]H���`X�����R]QW��H� O�q|T��I�FT�Y	n��K�?S�hݍ�ۥ�C��̓�'M��b���6�.�#Vd�.���i�߯S��R���R!\B�@X��P3u�Ud߅�M������Q�?rhv7U�E�\-z\�l��):3���O����~r�Lo��J�pj��	�<���r��A6Ϣ���KiI��t��-��,b^��1�x�ǐ��E���&�@F��gR�R�m[�Y���uk�+̦T|��$f*��b��=��Uo��,��$h�ʁ��>9u��㪪�*洏�/G}���N T��tr7���ScK%�C�m~b���d�P����]\r�>Wf� ST��4��s �;��w�u��N�e����i�N��(�'�%��=�'�����'��1��
��zzv��Dr�:uIA�":,��ё[n;��c?�svy��b��|ћ]om�<��E��Ɉ��v_�x}2�I{<[.X_`���K\h�0*�XqW�S���$ߣ� �U��.�N��qP��Y�"�M��$�ج��,^z�dO@�n'�g�0�}9�nh�!�6�Q����j#h<�V'�m���!ݏ))�nͷ3��|u��,�G����Wd2��`�w>Q/=�0����	J����T���A�l^�c�h��*n��L��ֳ�d��p���4�z���.o�bKEVI�mfN<ҷC�6�c/(	�4|����v������[����B3�Z���1_$����
yV��]yܲ�L$8�5*��>�]�E����f�5d��Eb�\�}^�|Թ�w�0���i�{6��
Ɩu���Jt�8��f���B*�n����̾�i}���#�is������X�6R(lOS��m��|]��ϴ8��`�j��P��\�3�KZ�ً��S�������$���-�=Y݉��{S��NA�{h�8��X����bG�b����"����W�3
Q�f�"��5�ZTa�>ü�Q���s�[���
���1q�Au���l|Ԅ|�\4O{+ٷ�B�dK�����GF�#I'#�^K�1g�0S?�B<1x�ϋ>���ܪ|>�A�ŷQe�7�[CI hB�ހ87x�����B�k.�9�+$�|S��R���m\TiqI=�����E�*F���&YQ� ��F�:g-PC�PɅj���eX2P/���!M�|�wP�ϩ��<�+ ��΁�ܱ��#!-ӑ��ئ=
Z�����֣\���C�Τ��
�9�HԻ�.�()$9���D��d�(8�|�hp�w�;�l�!{<��0��,���$&�,QV��������%�ƚ���Is�)f�1z���*ׁ��!���t_Z؋t�'�Q��\Y�BP�G����$��tT7� .�qC.�=�̘�@����Í�њz��τH:q���o��G�ƌXԕ$�,-�Y:u~9�Oq����^z���跼�p.@7h�Ra-�U����/�~�UEt�A-�i@�C�< x�K���M��e��#��.l����'ɣ�8n~ge�hg�JYw,����?��,�����DNv6͉��c'�1�)Mu	j�9�9��W�`��w�8g��K��bJ�,O����"dŉ��MHfw'�#H6��fZ�
���YP���`�ނ��:��>�B�z�@x"�Y���֏ޣ�O����5(�$�X�ͩ�T��t~3^�^��Ǥ�k�.I��1�b8M���I9��}a	S���|;���]��u��g��C�B[B�s�X���ؕP ��ԏ�}p���ȯ��������/Xo6�ڙ+�o׸�>�|}#��$�cv�{ʔ+��J*��e_�0�̻��ʇ�Q�ݡGW�6\�	i�THƂU���'Oŋ�_��1��Sz���h�ޢ^XA(Ag�y���]IH�tp���w��ԩ�ƍ���ߖ4��L�t�OIjc��.�J���}t�T�&�7�`��KƊ�=��?P
��{�M���1��} �s?W�{Xo�o�T�5hW!�1�u<H���N��xș�ퟆ�Ű�,'�����m��P��W��CF�|!h���8���?!I:�栎�/] ܪ&R���+������c:�iB�>�_ B�=îS���z�K(KG��F��--�߯���*��6ϴ��)�t����]b�H_�?b�j;!��[o3*�+�"��B��K��%����}��x��b�}�8��;e:����1Ѩ�Z�j��Ի��-�&1tɜQo���"k~�y��,���p���)sHؙ����R��xJ�����&p�q|yN�~���pм�UX�+�6gy���9���Ӻ�������a@V��]d�Jh� N�J���)`$��xh����k`�����+�(�s2&�u#�O�{ �l�,�vHOJD��c�5ﮙ���H/`~z �]�֙�G�[1�-�����^��&[�<�k�Xk_������p\���3�G����%rB�B<�V�<�����f�=�c�#BCE1�"
��q}���U�H�v8��6��t�B���{��9�����l��������;��|7&�˃�I�`���y� B	�����}�fQX6���!%VKɀ���[[��寄P�>��§n��3 ��Y��^���,��p����2���2��p��}�����g;��Cw쯃xnƃa_��.��ツS�c٦��nE���=���	���ɬ[F�(-	'���EP��	Y�	�z� ~~����X	���󩇯��NH�=H�归����gNQ}��;f���jٚVex���,��vC�&��"���kFx��'���;��~lp˄E�K+ȃ���w�ܪ8Q�
�Er�����<y�cb84��o`]�%'�� �kJT��{��e�A��Ruk�3��V�щ�����I�s�����]�?3�F=��Yc��U�N�9�?�ǚp��OY6nVU�ޮg�Y���,�q�wU<�dNW(�oM&q�8���v�H��dFv�2�Y#��"-3:8rƆ�b<�#����y��6��t,\XC�ڄ��敚O����@&&�F�>5߷�&�o���aDM�꡷���_���Ⱥ�n����q��t�PHLj���e��/�A@1UƩ�-xF�(�J�uE��������͓����mCy~[�/	"M=GQ�[p�`e���I��Ή�<��:)���P��[@��k�ӻ�0��'w���!,��\(��nW�j��z�=��_3����t�E3�@���ע�4��X@���,�n��F�k.�B�3<b��$Odqx�T�����QЎI�LT��wT��gIM�s]��M.VB��,�yې�hؾ��"%�O9�v�慽	l�T�@�L�ej-7N�MJ�_A�	���SzLX:��\��n�@p�{��.A��UH�^���:��m���!l�gb3��\��ji� �}�@�`nS!���Z:�ȇ���յN�gCc|ƊA���t�J���	���y�bm@���̢��Z�({9WW�u�1��ȡw���W�3!�L�*�?�5���'	��a+�u���Y��8�z�A�=��$���n_�wa|�6 � S�`��@_�`�h�,|'�j��\�io��"�=J�M�i~�S���K��&���?~��W��`� �s�����ָ/��@��������MfCغӿ�Et�$��-}1Ѭ\�d�U�K_@p��e���~�~��J�=P6谾6[���>��f��/顆���St��©����]�۟ )��B�jY����!p?fFu�&%�
7Ec�wh��s��[�a<֐�e����-<s�/@0��jnv��b����ıЦR�^i]$w��l��|Ϗ�bDʺ�6E7X�h��Ӿ� �-}�ܷ�x+�r�'.G�(�Hj]��ɹ�ʆ0��Kd����]ܟ��QP�|]kH�M�&�֎s^��<dq!+�N2Y���`�D�cn��T���/n���4���k�R�x-�M�[�x�e�o$��r�#g�.8>g�k�ȃ�ϋϬI�'߮��1��8_RL�l��%�+���뜲���w) oqd��^�&�#���a���?<"�����Yz۝�d��QMn�=s����[��x�҃���{�A���l��r��G8����)��?O�c��$�E�B�k(+$���{�g�� -�
��%�ߛqY�7�Oq�j5gң�h�]��:��Q.Ԥ�o_F��I�g�
H�UI"��L���~�)d߽�N��kK�	�sM�`�l���e���^�Y�Q�g�w�Y�靅�I@1T"�D�1�.�G����SH��hN/	1���(�L�?��Fʯ�3����^�[�m;;���DE*x0��ǟCu����,e���x��]�X��'�6�pR�3k	�A�>�5��w�?��|�@"��'�����@`m�����!�\�~cǬ~�t]�S%�[p�gw�K 8�	7����;{��b,1��l瞠�t���(��r}�3̀0?n�+e�`)�ޜ9�B��$*<�4��e�M�׊�&��s>;)�N�kqP���rVH��7�Z�[�,J��b ���9<�!h�]n�8ח�	"���㺄��V,�IR@�o�f��&�U^�U�_�r4#�]���!�,D*񬺖ה�:�?s`?M�K���s�����\Q����j�������'���-!l�l���Zǳ�������8��G�i�ª���hq���7.t5�= ��_+r�\TG����ѧD���<'�jK�=�L��!4j���2Iv8Ҁ$3����?�_��S(�[��|G
����Lپsmeu���"�����:S##co�H����|�<M̐���RhW��r#RL҇m�Z��~���%ٿ�y�ւa�xkR�a�1[��x����:ku؆N����D:¶�%f�'��dc7R-��z0
�͙�;6��]��#!�T[�pP:/o��(�������9��}/���\ohQǵ��4�:�i�e��rt�'sa���*7"K~v>{ r����>%J�ܟR�l�uo}>z�M��M����:�.Ily���w�- ~	4S{�+���t���Y����T_H5a����_�b��VR�c��w���NCbOn^A��Ը�,�m����P�n�h��v�'��$�]��������=�x��.!ʾ�<���ES*��Ғ[�z�$n�2i��S���h1��ʓ-��O!�H�����$��R�,+%�"x�ni���H�堬8�@���Vټ�~j�; q�u��#�5�`҉���i��L�{�_r��a�H��V���FN�m/�/�D��9ٌ����!��<��P\~~\S�N����	�������ơ.W	���]�X��[r-!+�W�HPR]���;k�[������$	95CE��d�K���2���U|4/5���ǟ��)�)�ίj]����u[���:
����=�BF�(@�y�i�R�"�V/��1M09�}��G"|�Ǒ]�1%�ϱ��J�X�)��.e�&�7��XQ	Wu�&<{D�Er����p�i�j?P�w~�����dJ�G�ܹ��o��t�D4�&�.1�N�(�H(h���b�w��KGsmM�}�Ec�4���nQ�c�*��������W����S�|��o����8�W�sW$�C���?���<N*�8��K�P]��v[�l46��P"X!��F��3��CY�/O�Y�|VR"h~ν��jFQ�	^�9��1�M\�Њ�v��O�V�\�eՙ/݌�P!���:X��6��R��R�A��1p� �O-��4ci��3x@I���1U��\�
s�����L }�<75�ǒQ
oH���>䉤J�� ٭��(j$+T�a���)ܐZ��:������)��H����KŪ5��G�";7�:��_)�E5|>�ӵr�.���� ��O�O��A78�^���$�[��Vㆌ�@}\����N��&�h*���~��9X�Hi�:�o:�i�sV��ۢ!���W�m7N��5
e���Tő⠰�!��ᦈ�q�+t��0o� 뗆ik%gT��.�.�=�,:�ӳ�����Q�-��4̈F7�uZ� �X��mo8"�Mmc���c�Ì�JW�T��??blVrЈ�n�Z�
��5٘?)d9GwN�������\I�5*r����v�x��T�9�\�N�Ʀ�2�?r�Ks�o��D�����Ӭ��%�ū<8�Ĳ�eP���?��6�����u�)����v��v�q�e!aL`+�Wl�[t��({7h��¨x�,�@�n�oM��+%R���%TT��K앯�T�BR�*�M<D�8�hgx�Cf�uA�CT���� ? ��
qE=e��34"���p��C�v#l�4fo���+�#���y�v��o�k9�&���!�E�������a&M�R���ͦ�0�r�<d�Uz���������'V���;p"Q[�|UmpW��p|&��˵�wy?�~:��_sˢ�]�TI��Aob��q��U�z�������n�i����N�=o�(�>	<ْ�a_����ʹ�S�� X��GS3p	�GPS<�=�p���Eb����/F"��0���{(�����E��߇=�}�֑{tm�5�h!�s��gO$�E�A;=?�/}��7RYJ��f�8'*�J`+j���y
���&��o��y�H�!W�����w6��.�'? ���� 78meL���
�u��d����+ɖ9��k$�D3wr�A���訰t��S�*�#ŝ�ˤ�l�����I|������ܶP�"qD�>������l��9:��qhT�$C���Kt�n�}�aZ��S�!�x(%�@L%���o�_���w�����[�+�*������[,�j��W��26歮�����#]E�7�>�E�G�j��&�L�)Oa؉G%�HEn�ƽ���n�'B��n<����uF���iK��N�z���������^΍ogɒ�x^��_'@�K��.��e&/ ������=�Y�/_.�:��[0tj�;��,N����E�o�����zfH�9y�L�g��fE�?�Ŕv �\`����խ��Z��'���i0�����1�h��WF���?�δc��x����[H�q�9.�˗��G.�ņ/�(GEpW��mpt�#޹�ߑ:^���s��Kl�M��NNF9�O.��1��2HTE��P=��{��_�(s���|MIW.�d4S���CZ�=�1v������
\F G��Q��}O�R{�v_#U�{����tK3��^��H}hmH�Cp,a3������F�:��W���ؖ+�CPk�Ag�|�®'���@�;8���}��|�a��W�X���~9lF%}��:E۬����68��a�s�TX�cQ��װ���Y�)2�-���^yA+Z���H����Y*��Ϋ|[Y�uk6���{�B4u{^i��v���g��"������55�|M)"
��ތ@^6AU�r$�Qn�� 꿙+�(�,��a\�D��׌gHPQ�F�UCۄ	�\����Ψ��D�R���E�i���̣qTbÁ���7����z�� �1Y���(�%�c�0�ి�.�;8�Xȑ�3p7�+��U��ɇ�)���9��9Xp�h��Z4����./���E,Ќ��O8�0#���Cp���	z�K�Ek���s,��G}�f��=��v��1�y.�~�:[�+I����(sf>Pu�U���.G8|T$��p����cL���GÎV�H�i�C�^�=����I��Jr}�F�u�Ũc9���#W�3ƛ�������{��'�X����%V{j��y'��%�K�nP+V���Bs�bz\��̻�9o��}��`��M���2��&K��=v��u���siߢW�I����=�g�����J���hU<"�KBۚ���l��8Y���$y���L���ȶ���J�*Z�hd�l"lD�v�C�B��2���`if��nx�-��<'?d�<�m��@wq�]�ub��S
���9�ˣ�}��m��������K���t�e���[��Փ+Qt��^ՁQ�9P��ߊ��q2t�$8GY�w�VV�ߨ��3D'���]�n/e���^c�a��&���0�,�s���^*L]�ww0�+���Fi����AǔzD�#^�4d�K�˄�2�y�:�!�q�^ �P�T��ͶxDe}���_z|b�
'�!��2�N�����!anf$��+'5�g�ᮻͭwvl���]xGX=��;�G�(�5%'6a���B��Glq"K��������6�g�Q�-�,2eP�RY�=��v	F^ %��X��^��]�]G�����7�����Vl�U����MB�Wk�@hPU�͡K��8���1?�@������N�q�0uf��f:�Q�`�hC05�ڞr��VDܾ3*�����,�yOF��b���[��}+F����oJ�T����������RS�J|ūa'L�A� �eo7�.�p '�O� ���5Z�)�r����H�D�.���+�ɂ �\p��˹����4 i"̷���fZ��M�M��1F.z!�A�ֹ|&0E��	���	4���z5�GpV �Y��ߋ�1�Ed(4��j���w��%�T�2zX��S���8�	��l��Ƕ�(s��0��C�oޖ!��@@X����|㌝��l!h���aw�[e=���"`tt�T	GpDMC�
���B��z<��0����m!�������^�=�sܮw�ſ�:��p��J`�,�&s���/a�\2A�蓕��~Շ���i�א���6��"~4Rk�~N/���&P6��˾�~��#�k��̎X��CȤ����/��f$�&�w�����?������A�zI����S�y�$V�7d��#�IF�j� ~�J(��*��r��k��eV��^U� $�{9L��Q��M
� ���ޔ���=��	8l�B�r&]��� ���-�a=/-n[�w^R=((9anm|-<��A��@���bw�g���	�W�>��j����@��圣�"��,F���jO8�	�!aS��3�d�9b����b@?�2�Uf�	��$�t+�
�=u�e�ґ��cʃb�;�<-�чy��4��3_��|.ڧ��U��X[фs9�[�s�tl�p-��#i
Z�����7õ�g� ��b>�b����)��87)g�#͵�o�*�u5���6ɰw
�o9�7��{)�<b���)Im�L��'6��}�V-Zw�蒈]��u�T�Si��=��&J��Ð��ա5��H*������,��:z�F<���k�@n�Ț��ԌuC�o;ӫ+u�浲�S�>z��Б\�mG��|� B���ѭq;�+���[�L�e��X�"gmo)�t���C@	������2�������b5��ۼ����װ����5�/ܴ�5%��v-wVl��R!���M�H#��f�'T�hT>�M��������n	ثS�������vʎ��ʽӞ6�4��Ϳ$��b�xg��Ta}�_�*�ݢ3�p6 ,Dgd�i�@����*�y�U�eG��U�0�����x �Asg�+J�h+��I��<�!v	��]��+ǀ��K{Q�I��]/��Џ�Ͽ�#�T�@����@��Y� ����o�mf��uf\<��ɶ���,��P��Jr�b�N� �����u�0���/�~`��t���J
=B��z�foS��T��2RYG�>/��?��^�����§�H�5��M齹Y<2�s�3�CG�C��fiY�$�?;��9ːr�7�����cg*DI�I�E3����?���������)a�����J$"�d^��"f�oY�^OC�@�O/��H��^���~��K�S�6��)�²-|xW\§��L#���f#x��vUy����ȃLwN-v���\�Q{��W�A����̂8�<��ǥ�*�j�ÅPH'׋w�U~��1�����d�u9��҉��:��X2(��̜���;��r���D�WJb�"�û�����ƺ*\�?��*c���!IB1���H&}+�6�����F�%�_���^Pт9!��+��;5�/ą��d�$*�ɡTohT}/ғ�"}+�T���T�/~���d�����N-1c�qqE�Z��.Qin/����	�<W	����h�1�~�|()X����1�������D�c�m��� LU��s��1���J�Б�R��ye���vt��,/��}�m�23�'�B��X�J�x��������.*EDC�$�J<z���	ͼ�Q�j�k�%=�����Ҿ���ɭ`q&�N��9z�7�[(%f���[gci�H���w��T�*�����̳�`?�\�m+���}�۔hq'�Ȫ��~꿫��f���%�(=�-��d��@�{i�#�����ӭ�uND���%*��1nAH�B��]Z\)=�9R�˲�q�>�w�V�p�3�D+��:�εW�*�����:����}�d���!�i�N	�?2�Ap����Y��V�_�� N�,�N�Ģ�ڗ����!	�V�O�m��{:���-H;�P���1�'��;��曲�e| �� QD���(ݎ�r�̹@�6N5�N�_jl5 +2zn2U�	��n`w�_ω�#�S����mt�9�F����l�/b��'��MI}G����Ϲ����_�I�QJg�7z��D�+q#C�_#2@�nq_�3H����ӮAY�&�p`��S���KY�P�s9�q�+>�0��!dY�?jiGU�藖u�h�vI�-Oh�)� �>�p&$�Ω�xQ�K(�<��R�8��v�J(2@�&X8%�� �ۋ�?$����b"<�c���o+��xmi'y�U�=u���pǆ�������d���[1���,g�P#�ScՊ�t3 �tS0��&8%!�*�8���>{���C�)&'}[vj�)T*9���ung;?kWM�'�s�F��ձ��]��^�nؖYo��
;o�v��C�hH!�)������ᔼ�:���e�X	�I��P~�S��Dx��	,��Q�ِ�`8�<��W[�K{?�|O��4�#U�{|�~����`����Ή��@`|�yWm���;�V�4]hrN)����xVQ�}�-���^�dB���_�O�ʾ�����m�Ȭ�.�!��cv�{�yg���	�i��j��Y�]]zm��!��M��}OQ�Ԑ�05�D ���.(���6O���g
�[xo�d9�*~��������dk�+3��!�:`�+���'�Đ�ԳH���͌�����5���(�ˍCW�H�.�c�K"��hT���J3ݣ�{�����3`4�T.ƠO�i��Gxj��bE,&�ɟ��}���"3���ae驣zP�D���c���T��њ���n9ʲgj`V Q9���ܻ�r�;a���Ek��sӥ��Q�lԋ�� ǙD��d�M�֎���◭���f��s^�J�� *ȶ��:Y�s��I��#����*j��*1��6<��.oa�̲���I/�k�ρ��C{�S�p��z.2��������!��'�c��9�]��^Ѐ�rt���W]��;�E"'��]lb��R�lk>{�-����;\�ﵪ����<����P#w��"l���M櫝ZL�Y�>��5���t���n,�"+��pW,|��lN�{�X�XA�ᡔt�ab����0��Ӓf������ ��;E�F�)n�F80�cHc�*�!������eS�A�bI�w%v����G�5`��[��Fy@�V�3�0�I|�}��C�HJ[�^f��X>K��_�9c���m�F�� �3�+܋0�����Xʶg��b�݆m8¦���ڕ��'T
�1��c:�4{��l���P0k�x��D%�$w����c�EH���Jhx��C}?D�Χ	�D'���-�0���"��(�xQHGR ����vW
3]��V��xC��@ϣI��]�j��s�?7>������ɇ�E�}�i�[�${Ï�Z��e�쑦J�]������J����J���-H�VP���%=��B��_S��Jk���4�h���G:"�w��*t���!���͈�����r8�\���s@11�)�J q%L�'P��#�����e�8z,�w�|�_fx��Ӡ9F�>^_K��m[�qG
7�,ӟNf�D�(E[�ɘ#gq�����Hϳt���ۼ��ހ�;�����;�S��2�(6�+꽈�AЄ��yf��wԤD�(ɻ��O\N�87H�� �����ZI��(�0o�T�g�lF��B�P�x�!�L�Ը�x�^��Ў�ߘ��W��)p�B_Z^G�Iس���)a�S3�O�*�A���qh�i&w���4�9����)]"Q9���`>�d��'�J%����8.��&�lGMsN�HH��@��V-x���<^L�b�	vp��y�D>D�̔��"z���ҭ��|��l(�ĆmH��s��S$�M��K'\�fv�:�6%���bb��[�_^X1��CAM�\Q#���U���*�|Jdܻ]��p�R�1奔.+`/{��B}�J��!�W������M�X艄1�ܔS�����H��й���DШ]�9Z"9Y�g�	�2�4B?v�h��3ւۏ���2\�s�M>G����|���
B7r��
�+]ߞݎ�5����$Y\2�l�:��B��*�N�v���P(w��(�)�s/^�|>A+K!r
JuM����f[`�F�J��>�v�K>9�X��֘��]������15*�!�,��#���rx�#.�դ�}�����o��m�L?�\�P�u�����Ԋ��Q�] �?�V�1�~�[��w'��>�~yS�σ���m��;P�Y�XŁt�j"���{"� ���XjX�&�4w&��w��ѫgъ.7`��۸=�.ob/cr![B����d�)s�g��վ~�����Ǹ���{y7��9��ˇ�=[�۫����7^l;x�h��5v�u�L������@��Ķön�#`�����s�Q��0��[t}\����Q�%c���c
~/(��|bʥ<അ�Q �.�'sJVƙ�	S�+�`�~��${8D�1$+�������>����,���L<�_F�����B����Z/J�t��"�SU��� ���s>N��F�ĕ@٫Չ�rH=~v7�0���>h{&�޺y��[[�]hշ���neaV��j;�5��:� 8����S��B,�^I��hރ4�4�?L�v=?UW�U!�ۇ�0�\�u��MM�z@9��"@��2�P?[�z�b�����{
n4B��x��P#n�<X����>������a���?��%��/��۠�q��FC	*e:��ݍf'9̸���U����WuOAi�3)�쩏�4\��B���֓�M�~`������	�Շ�%��g��LPK��f���5�����xu�g<���5�Ͻ|���eh B�����*��a���42�/4B@�(�A���D��5ɐ��������D�v_�@��ed�z�/�5����E�;A�RC6�\����ճ`;�*H8���r��~P�
gA*�3��C�J�"���/�M��^�YV9���k#T�	�I���XK;U=v���z�&�� ��X9��SK�J�b�_�ix�)�M~��ʶ�^-��«�w�#x�k�Q(C�I�b��5�tݛ�7�"���5wq��!�'K��b S�4=^�(Oxm��6��Z�ۊ[ɗ�N�I�P���z�>�̃qgI���?��k�q$.x��������_=9�D��3�È:�N琰����p�q�	�m��֍46tn�Y�E�btO|����^l����Bi���`�O��A�rV���E���C?k���F�R�^+ve��e�"9�ω7�W1���paM]9�����i<lA�w�L!�UxA��O�SisJxD���U������!��B��� (����C�D�:Q�##�����K.�����5GLE����a,b���7��&�- ؼaD/�a-�FӒ��x�4_n�������*WP�ֱ�Y��gp%��gS��4S�ل�.��u�W��9�n�Qj;����g���0f�o�TJ�vv�A�A3@ү(�n�Ա�F_�`/�ab^�V;�N��f�ԛ+�;���f�Ձ�A;���h�����ܥ�K���ܔ���|bz�g-���&Q���p#��������Z�"I8�bY�>�f2��Ҫ7�u�k��\y���p���0�։PM^���9�My�0%���M���]��kr13��:�)�&"���`��X~K���<�ހM�7d#�p�`-��y�Wx5q��S�Y�pk�+B��UiqgmyyL*;��_����]�^i����PZ�y� :����>^�*��7]����,s���z_<\*��B�<�؟��jϙi��G���ëǮ.˚�DPl�����I�4��^�t�v��q>����:�u�ۊK�c����^T�V+�;b��A='�x�`��H7��(gQΥ�z�E�/k|#G���� A7�t�nK���蠷8�����<2��|�Ţje]hTX�<��5���iUOJ1�Ah')	~���Z=�����r+�z�ID����7��$�����͒�Һ=���%������SՌB��V�_��*od5+-�$~|kQ/?�9Q�p=-1 ��T0X�DN_���{	��D�>`����7���b�2!�����9��xsӎES�!j¥�@�mĝH�y��{�)92��u���T[�>:�<m�77�xF�W�%�y�X!������al/��]��	���'IO�sѪ�jX�vW�Q��=��ș2P�Rs�+����uZɳur�VE*Qh8ox
#�����r9��|�Y������Z�k�e���4�B�޴�t~?w�R6M�/�4RT��H{m���|��mL�7�L�yOopo�y-�g>cvD�I�V��^в�ٝ����Kr������1���p
�/t�a�~�-pP�c�ѕ%L��L3pO�fN0�(���M��KX��UD�����cJ�!00/�Rr]OMI4eC"�x���&B |%뙋���h��ѧ
T㙄���� @Rux��a�j��$Tz.Np�Ǻ1 ���@�=�zz��!'�|cU��X�ǈ��^f|�,XE�\��vw��~��qGn�U\��| 'l��Ȉ�UX�o���	y,C�J&�b�'KKGp�����E#����F��uCb���w���EM#-WJn�b&e�B�,�P�3��r�*ٹ=vo�38�Od���yc��W]@�9�z?��_��S�c��J��U�+Y���n�x�>.-��-��tt<���ƏZ?-V�l��Gd���:�$��cjo��h����	�o�v�mA�& ���%_���wC���7p#�td�*+k�=e�*����F�2��U.M��B��(��^��
�Ƕ��Y� 8��O��ɷB�;L�U��֦�=�/3��鴷�O�2DK��j]������8��௵˳��b������ ���ō��~��:M��h�t�T�m�v���{���r���ya��#Fl^������d*����XK�IDW������M�S62���Z ���y��b�t�~���b��G2�N��&y4��?di` �������s�����8嬰�c�<刖֛��d�{��w�0�|�x����{C�
i��?����U�����E�=�^Y/�ʜ��l�͑T��\���� HRf$��Fuп�䤵�?��F��RG�w�'79 �a9|�tr��r}��I^���!��T�JW#�pt R�#q�5��d���Nd�֢[�ԅ DQ- �g�#4�iY�<��5��lۭ��yV��ֽ�&�r7a�,8���=d`Uϭއb$%(�+�/����K�u:P��{P��v��DI�<�uk���YSx����/l���V`W����J\��u8�8m(�=�+]?̓�yl0<�8�@�4�/=)�7�uKYc��^�y[��۔*�`NY���fg��1�ȷ��s��XS�qM���;K� \�qުtFp`v^�y ܚN���d���m�gO��?@�7��=(���ܦ�3�U�%���H(1����+�B�cx&�z��	y�L���z�u
� l�@M�-�K�L�#�e�U_�#���N�x�n$�Ӭ���(�9wXG�uc�a��̳r��)����i�|�(�����V��Ø���H]$��^�)�_~��1�!���>	>���ʼ�?�j0��5�qk#n��zm���k[f��:p�<^+ \�w:ę4���q�A���S����%�����+ݲ�2p� E���P��ޜhTrC�oxm2o���r&zװ���+q��ͺt��k�����(���MN����^Vk������4�\>�r�,�:�$Vх 6��&ӦjU>�����K�/���<��������F�G�Cu_�WY��maIĥ�Ғ��ع.�&�C'��0�dil$�GA%IK��{��C%�psJ�J%&V��(���Q�
�a}q�[��m�L�K
�x��DL&8��sԍ�d��o��?��0�"I`{f�R9�G�.$˶r̹
�C��i����(�W� \��WpL ��֯���/N&<"�i��m������֥rd�w�`��j�j;�
3"q)~R��tEN$�6����c���˚ȁe�uW�go�rG�,�#@#Ȏۚ~��,6W0�K� q+D��Y˕���]�"�\�����׺����Iv�U�p�ץ��3�ڶwo.TS��dã����Q7g�W��ٵ��x���I���/zfX��%�Sശ܍]��\C�,�6a�7hD��ݚM���� {f�(\�dsx�$<i@y^n�x�4|3��IRA���P2p�m=ҞѨ�慫��W�mQ�z^�	W	��V"�Q�M�$���0�AAv����$�ڈU����;�����T@j	v�s��4� &E��h5-_uǎ��厢Y\Z���f�����"���'l��ȵ�@�N�#����{|�'+p}���UƱ>�OR���g�7��B%9��<Ќ^8aq'�́s������w^����~+��m?ͩ]�W��akwk^C�4f+�CF�����2<�J&|��Nfi��m�������L&Ɠ`�3���dlX�V��?Ӳ*�JB$�N*y��Em@��#mY	�= o��F�!���-�"#�ű���/�]!Z�_ 	x^���'�`a�bU�E^;8��D<H%�?z`b��~���I���|�v:_>Y����	zoR��'�S�[�*��5W^ӵ�(����!���y�*Vk*�1l���Gg�a��1L	��dQߠ*�v1[ ��6����k<���?Ӵ�@c�`���Q@p�#|������"�����k�R�����<kl�q�~�Ǳ�9��bG�ˁ��'� Ɨ[���O���İb����Λ<
ʏ��,��7Z�jv�^1��w`Q�"��7t!� 6��5ɼm�G�#<��**�,��[������)��B��V��2u�a���̡io���Ӿ�Y�"�*�jc,�����`��$�Ȍp�@`�J����4��˼I8��FQ�Ij9N�Ef�����P�Q�,	׊�:	�}�:nԕ����m��o׶���|�Pӕ�EL�N�t��R[q.R BR}�S�����9�e�����z��6�W>�|���.6���B��[$nt�s��#�ϳ�A�F�/��ɮ�$E�m-3O���3�Ք&��C�A^O�."e�L������y�?"��j'��OcT<�y����)dX���H>�]�-pQI�3��J5�#��ϴ��Qq�͜��)2��-ѲGg +��
a���:�>Xz��-</��Q�y"��Ќ��("��v�8Z�	�Z������XX�^O�i���������d^�«C�ߣ���m1�뉄�5���'��]}����`��l���N�!�����͑.��<����+�r�I��~�+�YG�v��k��-6I��Eo'o�OMX���\
J��'4G��V�@y�r�tp��	q?�	��t$�#���u���3S��(�G��50�K�K>��ip1>�V�<D�Yh1/Iz���}����Ǩ/+>�9�ڸܪ����I؁��/Fb1@�ja^�ͣV&�ǧ!�'�s�&E���*\V��M9>6`�iv�dP�V��ǯ���?ʩU�L�*21�����J�^F5D�oT�ǜ%U�-� ����]3��z>/��2`�Gwμ�e��N�1�(�G*�*��۫���ʟ{�8��"(��0r�)��W�V\��b�_�pC�o�D~r�b��+i>�>���c�)��@�An)�	F'e��!l�D����BƄc��
̢ŘZ�~IR��ʳw�¸���7�����Di�E�f`����*�,^UbI�H��ǽS}�J������5��03�(.�;��;u>�E�1��)����[�{�ë�RJ�,�2\��~�DH�'.�`���@
m�ȁ�^���NM`� �K���ԫ���KCc�diU�B�N^�^M������n2�i�@r���'䵶&�����C��X�'gRG^(��9�%��u{��	Q''ц(f	n�[�lĤ�3d!)�:ê�1~�g����C�9�`�æ=���xء��U3k��w��7��������P�K!���6�E�T�u���gD��]|���;��f2��@]w{�!�~�6m���fI
_��xѡלu���<wm�
��]q�P�HU��Q\f��4��
:�*��yg��x�C�&�}�KR���6���e�vӞ!l^ؐ8��8:�BU*�9Vt�S��PXz���k�2�pe�O�����`��J���.F�HR�h"�3��K�?�*�NZ��D� ���"a�$����=�1@<�Ii�}�`��	F�[��zG���׀wbp��Z��!"&�����A���_��������%�~g2��Ǘ��~�+ȅ�N7�i
��g��N�G4`7>��ǔ�R)ޓD��r,�Y u~z�W-;҂��}V��?X����v�4��	��/����Ο^#��\��Ε���%���Y�J���ɻPN��jvp�O�+hC�2隼���#� �9VJDm�"�9ޛ��x�g����S.N� ����`���_{ZJ�:���5P4�����`6e՗�(3�Q���דV��X<���o9��`���,+�ܰ`eS�w�UԨ-��B�B�'ϰ.�p����9u�b��"K���i�l�l����_�.-�h�G��!`��Ł��yN��e����w�"γ�ԬmM��C��Wh�Ǩ!����CB�	+�!"�K�n�]�,���VC:�F覆���o��fABd�D��o�m�܄հf�����h��@�U����O#�-��rr7��l�������Ĵ�?-��BCy��)f��zMi�887�
E��6������fC�G����&���@{�!�S��54�
� ��J��r"y��"䐘�1�;7$��V����������	�޿
<,Ѓ��:��8�WZ��g%&�1���6����,ϗ�qq|����7xu6���c	����B˯�T���k�Gp��>ZO\|�8�4{x́F�V~ο�d��E.k�곥��J�]��//��a�F��S����īR%V��P!l0�Y�9�
�2c�o���C�����¡��~�M@��&J#��;���.7�:[�S$�D�9����R��69�/D���a�6��ANur�ҝu�!9�� ����,��#���ʙ4�C�m �~�!�ơf��'lb�;�m�W�_ۿXu��练�������x\����<�U>����ZX����t��l�P)Vy�Tr&��-�a���N7�%X�y~���\mn�G��㽖IP���7�/��HCY\��S�V�ٝ�޵eBq�)�g���/֋(*��}T�?��}m�9M�y���X���Бzen��"�<K���E�����.�ۈ�!������{ ����]�5ճx��b�NQ�-!��0ݘ/�c�]8r>T~%�Ck�Y-M�h�lI/���PO����)o�e�5t�fk�������� �j���
�·�~xp���W�v6��)P�`�N?�C��(5F6H�ѭjӚ]���e�ȶk$-�@��0#�O]Q�ih��),��q�)ȵid�X�l?�:%�M�T�W���]���{�g2ǟ�;��|�D�Gjw{y�Q��֨�DV���૕e\O�/�R����dhw9�b�ʝ�.!E���i,9@WUW:��
H#���]�w��6�.�TΒ]�fh���ǀ�Vg]ą�s��7bfu����D���Ӑ��Σa�)��wq˼C�R"��z=�O
��� �N&d���P�ՠ�|J��P�.ylȻ�9��+��fm��D9���U?:mr'\��y<JG${�o�|�\����v������%�D3�5u_���2�u"���8+�����5i)ɢ�E%Z��q&��̢���P�LF����E��pG��vgf�����~��_��npR���_Kx~��c�e����s������'�~y؛=����cT�O��j�t��,p�gv_~����ݦS���_�(Ȗ��VQ�f�F.��Ǌ`�`�����62>Rɲ��]���2��@ۺM��qV��4���^~*>���!���{��b�}3L�}�� 틼�뽾�b\��v3�;��W��3�
H���� �c��j�#̔P6VA�jgH��P1�B�L�M �	�=�xU;�=�]3N1���-�8���\�
��L�U���d���.6^��_���&��4k5u���ڒ�
 ��PE�p`~��E� K<Uh��`6�pk�h?豐�K�I��`�ȼL�����n�
��2�g7�7R�������s�_���uy�K0.�H�6�(f6~��15��[z��X1;c�/�?�J�S-W��Gcb��p����7���0N��V�$)G�Xc(Rr�J��M�����M��kJ=�N��rg��!9��2)*���ʾl��?�����x�@�Ny��x��J�Ď��$���=�r�G$����g�;g�!�*P�i\��|Z_m�����/즋۰���g����jU����wT�+D��b	;���S]r�`�|k�}F#��p2j˽��ՎHy� k����-��A# ��_MP�cH�Y��wE�Ԯ��/Ɣ����1c=��("�2+�Av�	�C��X�ou#U�+P~(YL���y��q]����A c)����z����� ��K�����EH��x�}x��g��F5+.����M�4�o��ԍ%\�e!`�����@����!��fަz��\���+�_tw�j�ؠe�"��	���E��n7v�=k�᷶x: ɸ+����6b�Ϫ�O(r{8l�U�GH�'�� ���n���٨1��TO��\��T6�nQ67����X��>nhL�8,a��[*�u�"b����EՏ�#��)>�p=	%}D�[ZV�"��������/{{�t�i�O��w))�a�&gML�O�
d,�!����$s�vr{(������Bi3���m
�C(p��«�^*���k��ݡ�/�ӷd٠�eY�u���:O�7�Sփ[�!��O��.4��9��mzyq�ּ֤�e-��@�fS�ŏQE�C (�>�p�@�'e�͙�
|����[Ip���p�l�?�ä֖'� �^K
�s�1'��P��9hE����WU�:�h����M:c�nAs�]�еz��6�`�j���`ph9��*i������v�2����qϝ4���ޮF��9G4���b���EC�X1��՞cN�~0��舜��*}�OG�V+�ĥƊ�Glh}�^�`p��2}���o�0$�B�6�?��d�M��gAchq�RX1Rِ��!�wy�c�4�޹)�׾�)a�Jz�Oo�_�W�c9|�"6;o������!���0*`���0_���Mͨ�
�$f�\CA���3�H.]�J��0Ik��{69!��H}�����Σ���9�j��_�"��K�d�~�v/z��K�1�"^M�E@���I����;�b����g軌Ga��V��^Ҹ	R�SIU#��o����:r���!�L��ZbPm���<�N�ͥ=�	Z�`��%p���s��_L��T8��Ք1*������k����,}���=��(O�?�N/>�39����4"�{��8�$e���|Z�ƷN�͛q�j��P��:w9�(�zn��P�D0���B�`g3�Z+"�R*&��J���1f>���gBӾH�&���N���1��@T���5���2Y�"�:f��l���
���v�C_z���-�j���� p��ʼ��{}�.'���g�G�ۚUD��1@x�����b�@������M��Q�GU�X��u�SI@��q���2����ej5@�CO�� ���q��RC��H�;������Y�k�t���K��o�m�9��?U���zX�؈BT?�7H.e%ŀ���aQ�6_fU��+�'�HT�L�f�&����!(IS��W&��"�{d�J��V'�ܥB���K��_t��Qm5�� ���5�
Hi��ь��FaW��o6�\�& �LV�W?����r���S���o��$�ϧb��1�1UmY��<�jf�'��t����E���Vޜ�` R�7�n3�ֻ&`��X���I���)��c�.P��6%3��b�S���Zp��[U�t�3���w�Q[��/7hN���Ḗ˺A!_{Q����� S���+�(RN|K�Ӑ׍����v^Aeǋ����PZ��i5���>��t�ެ� K��ԹT�ʂ�S("	�~���t���\���ޓ|X������ẖ�l!���g�@{�I>��a����)�b���8��'1h�����4,�gTx�9�2:�v�NV�vv��>'���
SE����n}B�t�k�V.�Җ*�% �7r7�Ў�R����]ѩR�0����Kģ��54�]��]��s3�B�1M��Vqе���QNv'聈�pa��\\R	�N��v�W�}s!.��P�(�������*c'�'s�<|�gh�q��C�l�٫�)���ŊF�]v b�HHdC��]ۆǚ���W��c.kv�S�(�bE\xY9���/@��ߠ�Ղ�ˮ߅�ſ2�d�Xޚ��_�����o����T�.1�8dn��t��Ͳ��1m��@�]zQH�4k���L\;��/��n�e�@�F���!&�~� ��De����.����mR6�Օ�SGʯ��=����r#�O�[>��Al�G���=��*ŘJC	)���@�K�DX\�|�!��АտWJ	WQ�k�c��@�>>����n�]�e}��,��̆CӤت\���$!Z���s�����E���䰓�.�����\�/ך����햖����vK�J:I��W*�.q�
g@1c�q�<���}�'j]�4�`���a'���q��1��{����sw����͎�������r��=�+񵤓o���ѱ{܋�x�a�B�1�ۨ��öe��Z�C�vU/�/#gw0׈�ƻI.���i�_����,�����ڨ��	G��x�iػ��%iJ��<%eo,��Eن���Fv��H��jK"��$���Ur �u�n�q�}p��`�;�D33�E|),#�'�/�~a��-�@��Z!D��4��%�h�8ͣ��.��ҫ���z�Y�KB.z�a���{�<z�߀lM��˛���Z���C�d[�͇K����n��0����Y.
/,I�>�*�������␬q%��F��%G)�y=��](�C��HG�i QOAih��\ 2���Y��~Ԗ�M���([V��9�ah�j��v�`�H���E}�(G텲�)h+��>�X���-���{��0��˼[1�('F���?��_�8���b	�k\H�1��>3��*��MA�2@_�\�oSbv�i�~Y)e�n�G��h�_�8��G���wW�UG��m/~�X8�d��s�mR��e�Z�*תܥ����C���Ț(�+6n�V}����J!Z&�+�ɻ�O��Y�1���Nkb����|��Q ,!�c<
�	�`7�ءw^�x��㖲V� C����ss�.�R�T�,v�t�l/���=�1X��秝f���On�����/AL�M��{¶$tŌ,�(���h�e���7E�Q�j�w��|�;�?L�M��V��74y��?/NzJo4�VӸ��y�Ffw�t;�N�_�
�.>����r԰~��vr�Y�u�y?�ذ�1���-��M숣�p�fc����8��'q��UA?�?�ԁ��u=Q%z!X��{T�$�1��Z��.�)k���Tq�ek��,�f��*�����L�u�{�%ɖ�z��;%�Lh�ڥ����F��VV�
�ԝJ�J)U�"��,K�(;i[�IL*4���/���cQѧ�}&�O�%�G�:�ώܤ��̃:4�����B��O���&y���g�8iv�.�[��mN2��,��A}	=��E��0c��j�Z��0���.�_�H$"�"�Lf�a�`+|�j���On�����S��J�%�~��lHn5g?�2�jh�<b�Tj$��øny���;�E(���+�Ƕ��ִ�(ߟ���bV�&+���&u눷���o��Ѱ��vS2�+���n	��q�(K�t�va`�oT�b��p���-�9�K�73ma�ě��}CȂ��ȗ�=o׆�|@t��t�N��;l.�y!�5P	X��;'\9��Y��}�3�t�s�������?�@�:�[	"�4v�xz�"�% @�&���� Z�W:�
�d��u��2~�Q�ny��mp�Ͷ�J1ñ[K0n�;	@x1c�C��Yf�����lz$G�[�)��c��
���fM��"��Uk{�ǸBiʌŉ0a���3@��Ű��L=��FJ�m�O��y�X*F��Yg�:<�G� ]c�!�����1�k�V��xh���)�q�~�'?�ջo����xIBl��a-�o���o,ҝ�N�b\Z� 60����a������:���-�$�֓���0�(erـ:�֕�;�e���g�z���`�/�A�Wfz� ��.b�4��^��(`-�%�	5�uX�G����X�T�挨��0�pZ��C��(H|)ο�й�[ڍ�
�����gy�8(%)�2�w�L���3+�H�͚�}��J�ۥc����3��|}��q�8Xýe�z��&C˒I=K\��U�Ò��\���jh I�����ES�k|�-5u���T �0y'
�9��^�A��l:������
/�ȣ�G=~�n���P{�_حm_��`�?X����L+oi��N�ETp�U+�� qkV_u5�V;���^�f�\Cb��[�n��6��8�1C"l<0�S\��#�v���?��U4ǚC�p�6�$/"�z쉄xH���;���8mW�䕶X ��}����ku����ϋ��c�,7gO�+ܐ%����؋�^(���\��D$1�qs:R�K���5ͣ��o`����Rrb���1��6�Q�d�R�E�����KƫM�1jM@�w2<s����V����$���P�kSӺ�-S*���I�F����&I�鐖�d�����w���3:����Ã �'e��,vf�+m���İ$�V��e��Ԥ[��D,1�̟F"����^��Ż�]f�<w�o>�Xi]�0���r��>�Le��RX�ƚ���TR���o�% ��EP�Ւ�&���!jO���$��Z�<���CN��RR��m��j+J�Т' bּ#���J��|��C��Z�q\g'<���6����w^���L��KT�

�<|�Gp#���B,El(dls���_���~
����(�:
cqEs�F�:�Dr�� +S�{C3��>��_�D�U��޸d�[�X;�����2i0A3Nߤ��1�V�K.5� d�8���)}R�����,D��v-t���}1���c6jh��d���I�an%X��� h)خA�z� ?�w��'ߩ�8��V��,�yJWx$���)`��.B���~� ��}1��9�h'�J �G���0��N��z81�N	��D�&M�0W^�1���fU��䙡�p��8E�s#��&',��ӹJ�Y�� 2#��F��O�=��!R�d8�hG�����(+�;5�>Z�b��'�BH G�������2��֩��&���r>�Fwo��ؒ:"�w��?��!(H���X���Q,�Ž�Nz�}�_J
'm��h�
%4�吟��W�TG�H���.���8���,j!�K�ah��VJ���	��k���r#���QK"_M��#�|�����̓���n�RZPy�����g)����B ���jZv��?:4�;^f�f!�R��m��C:dP,��<�%^L��l������^G���I������r�q_7�N����O@�V�
��A(�L�6MB�]xjVK�	��"2Ss�1
����a��j�>mA���>�/�^�-L.�v�mw�2}3;����O?vS~��!�3�J����x���K�E��9�<�-61�(%��Z���^�"5��B�F����P�v�@�H�Ë$���G�4��l�16Ƞ�Tp�Q��/��e+�բY���]u�g���&��b��nD!��:��،iA2E�Ho��.��5�P��Ϻ�ϒv0�8�")V$�'�;��ǵ�����޼���y[�;�^�Vx6����>�4�E��u*m��DP�'�	2"�{(�mC�|V����ܳY��݋\[5�v:�J��Sռ��JW�)����kh��0��la�8�}�?G�Ý8t�*ػ��V��"����%�7�B�K��~X��o��wh&ۅ�y.Xա�t��~N��q���qR�{� Cy�~�g�u�����`Tl�Kho9�x���s�ǯ�RO�a& �U�AI�DA:�_yg@.��L�`�/���Ȗ���)��v�2?��'�:s��@2��{5������kl�F��~�&�Q*���)�mnj,D'��\*��'E���V���m���`^��+M�P0��kל�Jhzsz �yx�����]�XYr'׭%��}����F�.��¨��5��²���wk�8����~�]���>[k�������z5%X��?-�ѿOTW�ŝZ�|X�h��fc�-��m.3���Qr��N���)���e��{��#��K��0bV'�Ƅ��S�s�A���7�3�#(����%�4�`�38)�s!l�޹�f�"����LD�l�Ɇ辍M�2�Ed�ҫ���^�.Ϩ�%�%��8�=l��*���z�DJǦµh�$���#:V�2lvԶ�s�*(�^D8or:xi���
����	�s�\�����X�H����m�	��Fak�T�o�Hn��WR�K(����+��X�l��0�ڛ�(�%��v�������0F��0�)���?I�"f/Uh�d"�"+�Ԃy�R���P�Ϲ���yO��CG��L���X4G|a��6�����i��'w9�ŷ�0Q7��<��|^Fh�о?�ۤ�U�[��Pǜ�@�)���w�_�B%⠛� }���~�W����p[�s���V���ب��2��	�w���|O�n�[~��l�j�K�o�{�[���<������o~&@'�����Pr=?���A�#�d٣7MưN����F��M�j��G����WF���3sCX���w��b*���4�_���G���'�	/��,��=�S�����e����M2m�>�MA�
Ŀ�2Lr�Y�y��fg��l�PY��Ņn���x����6aO��"��^�����v�w��7�>g�Ðy�j�U�B�ז�[���
jiDJ�Y;�	�mwG��=d*��Us�"Zf���j���/8�L�o�(����f2�C$���	aq~/��3��t��?�X��2�,lg+VG�l�ɪ� ��� ��Ќ�@��aJ�8�#�c��P[=��N>�"T�c�1�ON�b3��5<��8|	��[�z%\8&hi�e���:����FȇTH�7w `�4B�![Ia�$�H��2pK{��:_~�pYR�7�˧ŉNa�s4ͧ�j�ʐԭ�r�-$%&y��y����E���������<�Qx�<��d}�Q�'$��h�85��M�c
�!�ze�a�W�O�p��X@@��h��l�q��� �'͍�6֒-�[��8Ko�IwtU����%W3ƹ�p�t�Ҭ���*7�c��f��?�f�2d���HU���[����� _[«���m{�w#�L�� \�\XD+���NXB�}�t�T;5��W�`
�6I��&	*��'ʻz6b�T�M����ނK�)�y0��\���A��^|i/�#���EHx�����ӣ9�X�$�������# R�!�:�(-�0�B�=�-�a�νw�3��<<F(�4���;fi�6��d����C~�����ͨ��fh�n/(y=����%��x6�}��$驣]J�,�ZD�MXa'��?���N-p����(ň�_żub����1�������˵0.����/��x��
c��5a����Bʝ����Y�]�[��.�����&A�"5I����{|y4�^/ل����e�d�>[Lڏ��6ܝ�|��*����텮G���l�B�D�`��i�;伺�*�#���&�Ύ�yw�F]���#l���)2���w��F��������mаڵ�g���T�>�U J�P�Y�?��G�N=M,���>aI���m�:\�{�p/1�4�V5���y힞r!:�Q��ǅB�JK��|υnZ>�Mi�)�l��9�����>����fÖX�`�L�4�-���΢2���z������:�M�m���]ӈV^3�J���Z�Jk)�O���f���6g�k'��t�g/�O���0~;�����l���_�[���Yb����]P�+��3��"�	���
M��.0�m����|�~x�p�|��HH�Ev��XeP��[ج2�$�S�� ğ�
�q� �D%��;K[5^#�р-*27a�Y��)��[*U�/�g{g`�c?H�Z��l��Dy'��sš�{eK��S���-?Uٍ����k7�P�O	�ѠS$��NΣM��;����̅�O�����}P��/���
�\Ap�G���}�q�Q�gn��!
���-�	�B��>��iNH7�$��Ny��Z��^Q'Ђ�G�L�L6�.�O��Ix��%:�+�U:����6l���~�nV�t��׮.pP��G���.?�b�$�x����jvI�.�Ї��ƏN&���I��y��4\�t�|�΄���?�p�G�0�}���T���m�䄋���o��57�5R�#�X�k�KL�y%�:ҷԴͭ!�9Þ�\��a�1������L��S*�K (�
c��(�0
Tz��L*��	�ƫnN��jM(u]Ͷ���WAc����"E��Mw����������A�0�i+�<�D���u�?$u���Mߙ?:�
/�?׼���k�DP3Գ��28�-8���*�z�W2P�3�o0D�ԩ˺{�p�D(D���pV�b�jc.��Ɣ�C6�-�(��ɨBʫ*���(�~�b	�dipRN?�N��Hƙ0��6?��आ�Y��m2�nJ	?�������O���H�xް)�E>�BJ�#�M�N��IO��H���`=��tJ^��@m������<� �� X�����p�LJ�Ԗ�ί;�5����d���գ�yl:�����6�i~�֢0;�N[6�E��ǚ�PZ��h/i+����%P����<�[���K�^ԧ�)�/t�u��|���v_�5%D���x.t���[�>s�D�r,���������vP�H<�P�.�l�oO��J{p%��N.���*�bcLa�`j���d��On:�޺�:O�� �\��B��)ҟ��(�-��:;�"}��Z1K�7҅��c��m���]�iP�:�Α1�B+c�O��l:�
pNB�/���/{
��'��U���!om����#�H��� �G��'SG���^���~z��d>5~���: �pjGrmo�ˑ�i�2Ĝ�r������.�}M����蒤Tzd�pf�/�z'z��VV�Ѫz
M��r�4~�'2�c�5����F���L���ɚ�����
%�/�aiq�eW�<o�68i`>��U�����F�X��5+���%=r��!!����ݠ���k�+a4�ET4��?��v���>�����Jo�7m�w�	�=ص0hKȲ����:�QY�)EYϙt.�lcN(����8����{���l����|;�Q[`ך�]�ȶ8r]/b�k�<AƗׂ��V�/Mw��Qe�vq�be�h���(��r>(��8 �j���;%0��pQ��.�k����Kv1��g�so�(1Y����⨬+U��$���s��2�ME�����L>�`�v�x%`rz�l��2#�tR�Q0	O	F��cm���H�D.M�~��w?�O(L0������8�Y��NZyf�"�/iz�����V�%�dX�d�Sݬ�H	�?ڮ����1ϸ�U
�v!����b�j�l�4J-�X������k����L� RV��K�ʊ$�%0q��H/��Z�\RA�j��"l�i�y�ϝ'�):�Qe��u����`E��F�%\��o�X�y0�sᛐ�G��y�D�t�)���|�Bv�,Ƿo�؟]���CNI%#O�����:*U;���#��O7��ޟ��.C�X������}��a��#����p�e%�:x�e0�L��L��Z��2'O��C��y���l����lj���^��W��q�*� xYv�+��^�ۿ��!d�k*p�	M]!< *�U�44��`�W��zdL	����k�/��	Q#�aˠo�&���L&���w����fЕ΀RFu��|G~Yp8���1|MBb�y�|0�9L���1mb�~�j�����A[s�����n�]P�B��r2��\Y=�+%�;���Rˋ)ӜPJi)�ޱ���nAd�	?\�Q�=l/u�,"�A��}q2j䵑�����WOƬ�J��|�SSo� �����v7�\�$��i��?[]L_��5hPn��R\5ʶo�d���m�E������%(9J2���6������6<����+�|���l&�����������{rQVn��w�<Q���*��[�5��oK�x����o5O�CO����ӋC0
i�=Q�|D�A���x&ʂ�:U1��[���A�3�yl�v�P�X��}W�:B�����j!����K#��� H�Km��]�o[�F=Y�zt�g2����輵��d%G�.ӽ� @x��QPCLcK���?�7z��C;z{��~�M#�ػ=��.�������[���B��l"���;QR�&�s���8_�J$�݀��0d]jGN�f/!�,����&��ߊ.�~�(��Ѳe��z�IY��Q
��(	�*9�h#�|��Ȼ���]YV.���{{��g�|r���B����o���핧#�}��~j��W��hFB�%p���ߘ��/�g=�����gj�t�x^.�'�V)��1��(���hy�ou�$^��j�/�u������"����,+�P4v����\��vu
��m��;�af�jMD�D��t�#Y�Q��(��sn�W愭����Ӱ��0��"j ���~���]���~�~�����kG��j�U��t�\tБ�N&s�M��:�V&�@B�q��qE��v_k��5�_���>(6���{�	�W� b�$�������C��}��X�8T~�;K�~>���qu�L��O�a��T�O@�~Χ<�D���2t�g��x��Nrk��a��D�q�7��	���R�!���,fP����Oz����)�Nj~��M�dr�n� EAs��G!�p�(�O�"L�?�0k��,H�M�R��$�c��Ě7n����*Ə�U�{��!� �}��MRJ�<�N~LǕ|U�U����PD�狅�h;@0�~�|UC2m��Vg8w���hi���L�Q�*L�����O.�3ʺ��|����z�y���,�\�I��e�=Ux�T�<z�>��װt�`4�w`�s�����_r�"�N	�8��u

��F�����z,��T���[o�7NS陔s��*d�5<r+�-��ig���9��\%p��E� �`s�z(k�ER��)�꒛lۗK��L�o	&t�UHvy�W�@W�,�n	���V*��V��|#ZAZ�vX��.*��ޫ��q�� HV�5�}�@>�� B�b�G�
4v�ܗ���^¼Hf-()FT׮TU�YJ�Ӵ����;�;ʸ8��E(��	��N����p�4!��VU$�t5���Ȏ\��O %�=�i�X���w�*��w��w���c�%�!F�n,|��4Q��&������*ds�@n���87]"�Us��Q�����+	����H��GTI���������mH-�͂�K?���n�;����=��+K�W���s�Տ�5��N+@��ثT���K˺n������Jt�y�kE�A|���.�j#'�s�����v�U���}��=Gh�;;f��
�Aƚ� ���dr��*��d&�\�Eo��qL{���X�qS?z*��ΥR�2���;hȓ.���f屷��꥿���v��40b�Ս��U��W<N��R>�F�2�ߓG�/����5�g�4A��;���,�T��٧(���qM.ŝJ�\bn��'mot����ZR���ߨh�� UPm�1���@�e��ILxm�����3�SE��+k ����G�/{lO�D7�������v�h�|�4��1$��|��
�zz!
#��e`�����5?f����&�'������Ǖ�zwm���k�u�[�ޯ�Be<H����bX�����/Ɍ"�j�̏�LZ�4�:%���\߯m@�3� {�x����v��{��u��y�B���ÊH��	�޼:Z#Ҷ���S�Z^�(أX&��UU���4(�C�%Ɗ%.[���Gd�����V�_p@����Э��-�K�5L�aҪ��,)lU2��� ��%;�~Zj�C�4�	1���� �+4V-n�<��� 	�8�L��'�u�t�|�K48�U�F���q%�l�=wh���"��]�S�h���E���Wra���n���%���S�:���iy�'��`� �yI�f~*�M�/vy�E�:�����5�Ǚ�_����s�{dX�G��u`���SY��M��1SC��ܯ�,5�&[���x���.�8��=`��2��ڮ����o>�L�2��Lks��>h���&����U%6M��a��P0���rsw}���r����P�	.��S>pǪO6���b $+���Ý�U�/�B�8$m1�Z�mO�7e�qQⲪͭ��^�(h�Ħ���L���@!��-��G1~	�n ῈM�,��.��[����?���Ŷ��zL�	��}@F8�x�SY#��%1�鹝��"���F\�qE�7�HO����e�W��;��/S��� ��qx��t~�;��p\ײXxN�o�5�	�&`(P[~���l���vǴsp�<b�����P��"��"�1�E�r!,�1�
N�� =���[�14Al�v�i�s��3�l"���hT2���`�vF������m<F�h3�2ŝ��0�����g/♋���w�nE���?�?q�?������	]t��y�&+
��!�/W�#�����C�#�}҆!�v*t1�½X�V՘�l�xP���p����d�BKfTK˓ؤ�����n���9$L�dj&v7�`�]4��tZ5P�B`�&(p�5�M���@��xK��5�5�DDm���u8n��Ivʟȧ3Sq�_���^�6�_�����|�ktvd�>��=��v�����|��׀�Z��h�VR#��
I*�9?�E�D�)$@�6p��#�_r�N�@�ͽ>����n<�+��EM��-�K����^���N,�-H��.>H/������'Q7��M	��n��JHnw���ƽ��EM�}��߼������_�9an���T�֧ ����'�/D��c�A�h������Kw��dK�] �>��7/�y
�w��K
p2w��<�s�$�������O���|�<��.�.�|�U:�J���vZ�쬂��L2?9�sH�v���z@låz��!��!q]������|%X��!��jT2�����x
ƦЈF):q���INɠ,�ߡ�zޓI��F��D��|6�����,?M��D��ʁzԠ���ɍ��n�(f�u�[���gm��2�aѤ�˂[n�)�/��~3����"2�(��a>P�C��Y�3�W;���s��S��]&�1�U��.YFX�C>�e���sL@Z)�"8DjIE [�W7{����v�<��a� )
_ު�d�W�o:w�8�
$&�6{h�;1��u;O��5m\o�Bq��a!�{�����"�Y��톁���{�.'H{6���E	n�̀����Ju}���� M6Jj��N��u�2������&�Ns<����йJ��t��a%�l�?�u j8�(_d8�5T����:3=_B)qqVj�{�V9J#�v��4e�����)v�@�b�XPAj 9��,�q��<�)2��'�q��7A��L'3��� 7H�r0�)I-.Џ۹���j�SI3f!&�>I��i�.��i�i��~��r���|r]c�.I��xH'�퉾l�72{���|I[�6v����->�5���ꫪ�����~lG����
�D������3�ᅨ���;t��\R�L��v᫺>	� (@s`8�BK]�D���=Ѡ��֠ᅲH�sTw5�D��5n��moҸS��4�8�s�}�,ce'4Wl�[�i�kD����-�3��AN��+�TNr+�����КxiE���/l���T���$ �BP���B� ��/�����B[�_s'Q��7E���I4��v-��!�H�w�-\o�8SҬ���B�1E�@'�*��6�k0���>`��E* �z^4�֪�*��S
u~�MI�Y�F�H�E�K�B�t�v>��`���ȋ��&V潗}I���^�*t�ɣ*�����Ww7�#5T�q9�m.J�cS����E�-������S���p�d]����o��w!����+7�Y�=��" ;���7g7S���\I��q;S��W���4_���}q</�P=�0�/<���"��E ����i�c#$>u"+e�D��r�yf9�Q�����3��P¼���B�z?&���� ��򺠕���lKElw��-h~&,�s�F�i�~�t
6��{83��K����8�æI�±O�^eܨ�=?8q�9iDv���?$���J]G�0&���)�c�,��Z�+���o�.q��r=��X��u)i��z��섢J?����-ۼ��Ƴأ9���r���x΁J��<6J��\q!�2П� iz@�S;Nw[N��6�%ǚ�;�T��#�����Z�Z�`�a6uH������;�ԬD�3��|R�������7U&�mh;z�.���P5xA-��*cX�����/��_��/"�H^9e����Y}Ĳ � ����>o<�����F�M�9��L,Ѧ��S��!e���#o%�"���m�����Q%,*ؕn ����"�B���o}��A|�U����Nվ!�6�{.�<61�P��(3`U1����Q:���<���{��m��xrx��o�����'�RJR0i������	 ��y���t�9��)����7"���O�9������<)ճ{%��4^�6�+9���V=c�<�`��|E��b;U`��h4�0��1��r�\=Q���lҠ�q���ta�W��d��}7��=��N�}�}K!pn��/��'5���"qC��׆�����������q��`�וh�(��������5�t�C��Jtu�`�(��3��.a���S�e(e�X��5!OM6�H�Ix��[g���D���m���;�%3�� �>�K�x)>�qX����p
�7"黊؉�,�(c��o!�y�O4�c;Y�?���Y�y�r�d\��nw��@�<�:1���+]�H���~΅q[<׮h3)��Dmg�2j�W���ǈ3��Zmz�6�@r�X��&ͼ���jǇ$'����w;
�J��s�lÆM���y�Hb�G�/���?�jޘ���E��2T__�:V��������v�?dn~��C�i-�I�t��o��2'"��1V�+��/k���J�rq{ݦ���?�����u&�� �'6X�7��k��d�eT�$�n��m�j�G�A��8��N��G�x(��WƘ� F�t�L�ʴ����ʣ���,�N�a�z�OX�p�Ar-��� #�����,�����Ӆ'(ƒ��kx��i@�蒿L4F��"��2|wAdܳ2�/���7��㴚��x���=���Y�G���D��<�r�D_+n�5)D�sj��M{7t�|��-P�ԪbL�Z�٘U�;9Le5.��@f05�X������S�b��C�!h� �iiQ����'�~�uBsc���`�Q�u�%J�=|��4����k�,���ۻ��1�Ϲ��
�wu�@eG	�$h5
q���B��Z۩�����Ѳ�s��o~Q�V̭� 96�����b�ALJe3�]�jX�j�T��ǔr�0%3��:�Sa>]�~_��9�����-*�`����+��Rs��IyD�(M���0�M?�d��q:�
K�5v�ca|R���]l�=�&��3�Gi,6C�!�6O��y�S�&�h4���n>u��^���jZ�R���43��3�GNmX�[�>�S�����<��@���W�����a҂o�X{5T���[p3si-.��3��o��Z�R�g�"ɿUu��:��rjD)˱�L��qD�jL�3DH���Ip�o�����TN@��7���`�?��u�0&8m�t�-Rf�U�~�aNΟ@��J���fY�'��Q�З�4�F�Aʄ��V�nᜊ�H�.�2s�O*��W�T��;d]^��>&]|������<�����AG�d�$�&�@<E�B�KO/{��l�r�k�xRNC`.jIZ�l�;�j�b�6���Yc%L�����(�͎%���~�*�%�&I�6�r�M�Ȃ(�~�6�g�������g�� wYf�h4}�n6��-F���8Qm�Դ�v����S���06"�Z���q�t���$2�:L��F��H�tDh��e�k�4a�^�M����Ё�v�s�,���ӆ�	F/L��<Y��N]���eЧ����*'�䐥X� _��Ɡź�|k�����2�׵��wЉy}j��4��]�iр�"� �\ޥ�F�0Xpy��~��#����E2���'�����Ӝp~�O7D�`�[*�6e**�aS��eG��/_�=;�C'��v���<G�+,~iMJ�b�Ka1x!*G��`6�D�鞷�!�,ѡ����d_`��Pdޭ�`Q�R��#�{ [��@'l�k� ��߿3�`xI.e��B�I�F��h1�uĔ4���5�'Z����4頣�o�Jy)Zi���KKt�k6޷Fj>ﮇ���;'{�=un�����X�\Xq�!`�-�}��ں���5`���!q���b(�C`b�b�������n�VQ�3rb� ����E����F�"6Ҝ��e������7�12�҅!��oy���8l��'35ʴ�5#4�ZGҘp�y�1SC7�����H� C�J�,l呷"I��RD�"�Y��wG�V0
/rVD�{E�A�y�N�.V���8K�C���{[�5<�N�&�i���oڜ��K ���H/�� �Yۤ�K�N.�$����?���Ü�5�3��&�����,Jh�����;񻆊#�9�r������Z���C@{ ��//mn[�k�7B�|zTC�H���q�1�JOl��(~��0j�8��	N&�|��fB��I�om޹�My]�Jٽ4��$�]�Sx�X�|����֯�ݛ4��i��)����dyn�3	�d!w[�2s�C�g�1r���H�Q�m��1���NM9w�i3ã�V4�s�D�� �7��-�V�ߦ�7��=C��Z�:���jFT�n�o��eD���6?&
��Ԛ�l���$�p=&df�`��$�B�Wi>?��s�U�'��6o��Wl|��������6x�ʢ|d�Ͻ��;�Y���ڮ��ｊ,���!keTn�r��,k����n]�L4NS��Հ09 ��/�HF���%���I��a�P��pZ�?���GK��ϡ��xϜ���5<���Ϻ�I�(U�' | Ju��H|0����=ڜ�}(�?��Ԋ%N�4j��n��ĭ4ގ�h<���&�/�R�cK$�OYJ�����s}/i����C��PssSCr=P��r��1����i7����y%jc�����J��`�~�g�2T |�c �ؿ<��Nh��}Mx��w��T��?-:c1�W����yB�7=�G��-�#t�2c�V�_aR�l
�3�Gq���z�ȌV��"Ǆ_��G��y��p��q[߸�N�e����;�y�Us�(xv	�M�Y`�T�r/9h��Oe���������H����y�,5�&j�=��g���n��Ǝ>_���c�I�	�qf�Z����'`!�����  ]̇�X���H��W�ˍJ�j����S��'��,�~�x
pq-8iZ�0-��-a�a�$?���Nr.�Ȉ����S(-����/\t+3P�J.�NX{U�x� �[t2͙����X������9�jȣ��Q��	� 8;�:����W�m�YKM	I����܍?ۆ�X���Of�g;�����h��s�i�P����U<�Ⴑ��/�&S�����q52��)���E�&�mz6���.��)�g�K7��ʉ�%�1�pQp�gD%�k�3_��+����Sڄ�7Х��O���s�C7�7�`���8\q�c\]�7"���g=8-� {��7���:`�z��a]�(�ܽ&|�G`[��|H��mqGC|Ǻ8������Z�5�Y�u�XoQ��X�,7���򀸇�-�����+�J���A��P}+�Tlk�.f4|'�/ v��28@�%x4�I�5&9k7���l�,����g�`5��6NoW��%��\�-j�5Ss+���N
P���s[C�4G`����;�S�mM���d�TS��"v2?Ff.H8z3�L�uZ��p�z�3m�W�6K�Ѭ�w0�Io���ɉ����<s"%��G#�IC�(bu�GB�p�*���Trzr��]|-���#�� �� vP������K���|o�i���T���d�g	��L�K�uq؟�¨�L���HR�RJ�d;tW_w�uh�aZ���ڣ:�
elT�$Fb �7V�&��,i&��.4��b����]� H�Cr&߼��HpeۿUJ'|s������B�q@*Ҁ�|�d��Tu�u��]e��2y=҇�wɲ�B.��Ưp��v���d���_q۫�:����%�rsT5�K΍��N1����.�	kN5��A�ͭ��Cm�1)'�� �"�6�> �5�ws�/9&a�@���h�Lu��O�����?^��O�<kTK$ث�)a�8n���4\��5素���W	B���_ �e������E��ji��k�m�b��(ŝ����yp���˳�Y�w�s�/�ME�U}�����蠓��^Ѐ�K������A_X�ㇾߥ�G��� �o`��Q��˯���m:�"�}�Ĥ1��A�H�ॗ焎�jV �/�,չ+�3���r^���-L�������-�5��&/	�0�{��ڠ�6��[9a����1/̋�@-O�;)4�pB�Gbe����hE��K���G%�=f�*h��� �A�s����[�&EŴWv���X��,V׆�����	��Զ!��V�V�� ����˕�B��[�tڪ��?m�P�5�te�x�qБF1��Z��*
@8�m�o�. r�!����s!'�>�义�q���iC�iP��Ҳ�E��d���u�X�_ Xv���9����s3��� `a�I-rz��P��R99m���1YI�ҳ����$g�.�J�wK���B�uDԊ���V�U�@���Ss�
ʋ;��m�B@�SU��N���X'����em���W4��=�����d.M$}�У��VA��-��Y�~|�� ���X� ��M����b�uD(��vO��؉��L{RuǸ�^��+>G�mAF��{c%Yq����	�NWE M>�Q��б��fIA���h�N_���9��j�U��'�B@0���m��Ӵ~����uZ�EO:X?^U��+���x˦���y�C��f��DF\q�6��+?���.KCzC[���Y���DFK�Gr+q��ٓI	����_j�����?�g����[��u�����Pӭ��!$�B���li��x=pr4�$�o��aM��ׄ�����^��ϫ9��h�J���%j#o�5-���|��y���H�x�x�W��^N=�[Q3B H9��a-��L����1&�N^!�mE�@�{B�XN�F�b��1����|/��S�a$���)����9픑�w u2����f��ō<�P��\�c�������f3�o�}�+�?�p��Ǵ���%	,w�H?�~��3M�x��L��toV]�ݨfI������23R�ڃ��]A�r�j�*��50_\T���Н�+��!�B�����n�3_��-��rD^�7��Ys���ڠ�Ȅ ���3�؛=�!��][��Z�h�,n-����)Zntj]��y+`�����xjVZ����J��=~-e��ݴ	��P�mc�2���I4η���nC	�����%�fT"�[i�b;Ȋc�8&�K ���1)��^��>�Lw �g�2�p�ގ؍:&z�5x@ר
�h�2�H��JI�>�"�á伳L��&��c+Ύ̮��l�%@zç%� t؊;Wf��,xG�BI]�$�'�C �x�67����/�$էD�������Ͽ�[ۧ;e�ءigD]p��F IX�9�EM����#�b������Ϋ9P\�C���{z���웶R���h�6������O��`��D�$oj�og'�x�U����.`O:Û����M�����P�-f��O����p��y�KK��������拯���������%��eO[�Q�iQƾ�b�&�8n!ԜRp�H=��{������r����2���X�:0u�1Nm��]�L�A�l���*���*�.ǽ˿V��C4���!^���%.���湃�8�����RlL2�߰0X�㮤#@:�lUu�lp.����z,1�'��u��	-E٤By�{��l �>a�Ψ��}�ILi�C�a.z��d�r<�4
}qu�*X���Z�BM'��.9Ul��
:��P?j��{-�G+U�&_>��%�R�	~Л>#�z�_f+2M�lD_
���VtE�Q^+J�N�J�͵�rST�^UT�3��7����.t- 	�H�Q��Y�&��]t��f
�7[ߒ4$p��!�<���*x��b�w:���mNU2�y�[�W7%�au��~�T������Ss��Μl �<���uO2�:�WYMIM&��e�2%�	Q�#2Uhi�W��6�Dݦt�7D��9�SJ=����~Yp0ϩU��-Z+N�>��07P��>��,��)1�D4M�Du��SPꍠ˵d7 ��J�0��6X��h^�k��o�Up傷�1Y��ݷίƾ����Zs��	['�e`0%{��]��K>�D������֜��<!�v$b׳T9���+���#I���|�Ї��.Z¹�ft�񗌪�J�����m����ێ��Ӿ�v��f��)�z���I I���Z��~��S��O1_{�Tt$n 5���¹T���叜��'�@�<�^�]��X�� �?b��)����k����Ì�P���b4au�Ie�� D���o��ZL�.��4�4��aɆퟆt�K�jXBd��8;Ur�(�[�k��h�5$ӵR��������g��;�*P��p+��7^��3�,ʓ�T��f����Ix���Ҟ��NI9�qp�rz̆J�� 9���%؇W�����#|2]ѯ��"M�p���4[�=9-Lo��rp���ݺ�<d�q'�FF��dO��i�:�=j���!R\~������,+�7��R�
�����N���JtΕ���B���Z,�S��S���4
\�����i���,G�����p)�{��x&Lדy���&,Q��g��y�ST7j��}�0ïbG�+eRs�j6�e)C3����'/�2g�gڍ�v�EY1���
z�ɃO&j�p?T�-�7z
Մy��t���Ti���1�Uܰ඄8�`��x��^_����W�X]Bڀ8)�E�3MMu6��>c ����늹(����d҈��%�gl&I�Q���pu���!,��j60�t��
d���@?��?m�V!�'��n���y=�����)�,�_�:�Z��[`��Ґ���7'b���=���z8�F.QqO��TEaxd����M�hԾ*��9�B��
2D����.���U��=�ŽKaj��61,3U<�F.���l��fX/���D�.W��0�Gȏp0E��#���%�'�h��&�t����W(���[�u-u�f�q�i"~��&�y���:�]�������>�T�-y+s.X8z՚MVS�e��pW���[��&��I;}K\b;pm�O����_ʤ���
�	2���׾Q�ë9��~8���.�i���+��nx��^@�\�2���FK �
���T�^C����\-YFy���2�ḕx�~(`����m1��o�qG���W;�l�� �>����&��{:�����;n$���\!��_���Х����*���Q�k�o�kl��a�%����;0	[���@�A	���$�f��h.Tp�~���΂4fsB���
�S�&ϥ>�f�d������!Ȣi* {~�5��6,zVa�dV�$���T9�*��.?\S�X�������:�1xrb:�Uhj��z����$�������Q�_��L����U�q@�<f�P(�c�(wr�g����b�JS�Tr�'���j���1���L��;W2O�T	|{�ۄF�Ń��/#G�ҿ}�o clO�*��N��,�܀���h��Ȧ��Ɇ�6�ty(��H�Í��D�;'�<6#]�݉�(�/Nx>�z\��6�e�8��+��{�n�*�ۚU��q"��Pz��#eCl��'�ag�	cD� ^B]�������!����G��^�~�)�j�6'��Dp���խ@��j�a�u���B$ܜ���}�Ι�3u+���V�xH�x5�z���K��o�#@?��񓔻�;Ea��qI+ޏx�ֽ{}�#BOҺ9��B��Z��`<�9�=O"�	�mf_W���=='ZI��R1��<�]g{W�JBcCt���B��q��P:�>�>=5��0��jeZv����J*`$�T�譎f��lĆ���836�Ӧ��=��d�ﺝ#Q;���3 ��S̡ Q�kE�oB�(}2��$C����p�i�ܠ�1�?�<��H��q�+t�g"x�_8��9�͈�*���.�2��J�|_Ë���#2�8j����`���8�'i)�Ș��LC��[<$��+���Y�G~C�㾪 ��U����ܾ�{��ny���e�ێ��Y��F��K^RH�xg�a��E���H��3v{O_7�i�G�Mȁߛxr~<��qZ�;K�a4�G;�%mL�tRv���<�q�I��e"�u��c�<a��h�A'��ڍ�cR~'e�r<�A�<�F��Dg�����Ve�-�f�]��R�N��i	���a��*���c�U��|�\A�QmD�Pd�!����ǈ����7+����s5�\x*oϕa` ��&G�"����'j�7[x�=E�j�<��|�*�.*�V�s�K���D���fY
s%+-N����������9%-�w�T�y��x��,��F�cd$��KX��҈?@m�E��b�'1OLɞރ � U���=�}j�Ы��@� ,����M���e����+��X�t��l�f>Ns���Jm�{\���U�P/��T���������oV
?�n��J�}���� :1����Z3δ8.��0�|H��R�#�2V�[�����UC�c!�ʜ]�ҿ#l䞪JT�j E���`F1��=���JU�*�8�Z hDGy$ᇡ#j�]0�%8���Kf-�վFKx��A�#�t�];s�B��qjl��Re!�{�\wT���~�[��Q�L��8�3Aخ����t�QA1��u�O�Y��`�?!Ҵ���(`��5��ю�7���	]6�z���Q����۬�����?��x�q�'�)�+I�9)@�>�Oo��XR��9Kh��i�e2�~�)S��jصo��A������(��t�Ϟ��{���vaTG�fEݧ��G�����R`�;j^EMO��@[}�8��9���q*6�	�U����z��xdt	�gr��ku2��hk����P�p%k�n��.�:= 5�G�) ��M����hv������Z�n ��c#s̪�^����Kq�P`�0[��Ȉ7�0�_��N��y,�a3~�ӕ���м^ �g������*=��.��@k�q������'�7kS����:�i3G��ׁ� ��m�%ņ�ɨ,�_�+���d4�(90�CWi�.*=��A`xn� b�2j��_�����.�	�������6r#��SZ.��	_>K�g��bXP]{����4DlΐM������`1��]�!�S�E3��92���b���W�]D�R@��#=n:�_'��hZo�P�2$���N3Fޟ�`ߚ's��x	C�)ҷ�R�̣�m zU��u]0���ԑ��̂Mwn��y��iB}����yi[�Oo�(��*����
���S��Π�_9�����o��*�v)�X/���{+up�%��G{:P��1����rh|t��`r��~�Bf��Q�btf��G�Y�I�6���o��!�F$K�)��*�f0Ge��**S(���W��`�(Ku?�d��}1PYĚ�71�pS�A�rVE�����G1�.�a	[��#��6*Ajv�{fx��o��aCG�A0R�%Iɞ� 뜯���%|5��
�fG��0O����p~���z���金Z0��tYdE�Q{g�)&M���3��x�N����(*�%���9�3�5�j}#�_�w����E������"Z�T_{�D������@u��q#o���DզW��90�/��bŮeY;W;2�/�t�53W5��Zd`�Ȉd����*B/��[D�"]�G��d#J�ܛ(XP�iKSo���O �M�X6�G��J?R���ެ<-%.�*ę+8�Ί��#�n��Ta��8�#}є���|\(c�y�x��"sԨ(P�#f���\�?����~AM�&��r�O�t���_�%	�j6�"���^�ۋ&B���1K���T6[h��Ib,���i7�ń�p*��X��r$�*go���T&��R�%��p�M��m7�&�d!�8��g�V�S����g��{=�(#�X�	�Gg�W��bQ:'w�֒�d�{�M7�*EAr�}m "��{��*<Zz,��7��{��֭Sɣ�fG�bkl�T��6�A DV��y9���~6������V��9�.V� OXK4� ɯ觌�Ƭ�/x[K��Wʯ���a�T?��6Z����c����|�\�|�!B��sT�n�p�p-�v���/��H`7�	�"��������� �H_�md)	[R�,g}K�eI'���V˓v.���,��%=S�|�kτ2~O�(�m@��I2�Euгø$����ڌ�}a���S{��j<K�3A������k5���:�W��<ן�a�I��T���<��Њ��.,$�jU�ҔF9��bd=��;��N�8�Q��=T����"��O3��MOpL{Ї���kq9��X̞�Y�q}w����Ym�����a��@����`�P~��� �2�yz"26l2Ap��~v�@g��͵V��e*´�2�Ը�J��L�[���)�b�0Do"����b<�-*�i�g�+⾦.�y��N�����9~��+�Fɧ��ڝYmG��jd�:HJ�>Ŗ��h�9�k����4A�D��l�����z�?D�R���4�+<2,�ۼ�{�M��¨ƟY�<_
��K�~�m��㎲,��׶��D2�Ke"�?`�&[><Z��4��k�!{�Ц�D��7�(Sza��} �8��ԈM�g࿛��WQ~��b��A�+�4�O��?L}I����~õYI�^�F"���}�Tg�ě �w�]Y#iv[l��@�8�sX�-w��XY$M������1UZ:�U�?��6�Si��hi��^,��Q� �覓B&q�m�i+������e�+`T-x��y��N'���η�dé�sy~�)�N�uA%�:�v'Q<}T����f��u��K�S��ǐ��؏�r����lxS\���E�<o��̈́�?1s=nF�5
�l(���[���������-Uȓ�
�-w-������X�8�F�(؂��K��S��=U���_�"�i�\����s�VsF�K ��t���F���ͮ�.�݁Ws�&��S�blC�!Й$��bV}��-�g��!�����Kr+�2 �^�cn0[C�.�};>�2Q�U�)l���X��̡B3���Ŷ�aY����'x]@��V2���2� ��[�5��T������2�n�w��J��DLX��۲�9���z�|���N�����~��h[����/��Ms���("���(;���������_�E��x�)���}q q=�O�����߉���,�/|Z|N��~J�S���MnZ�&�%��T�{n����pڠ��q�har�K��d)�N�1�҂|�B�j�D��Դ���Ǘh�Q�c,
��	wr�9��:+�do6��v��ʖBȴR����^���fv-P�Lҷ�YQ�����2�
Qa��g4������n�LM��c�8
�粄�MB�1�8�:�=3�N��]�,�܋0�}Ծڂ�K�,��ql'*������������\�*f��+S	��*�:��x(ZÃ�_0O7�.�ձor�yB)�����=R�S��=sBU����� �u;�L�	s�tq6z)�X:H������=u�T]�u"�e;�G#�vv��D��zq2=�[�Fj�7 *�ˑ(���� ����\].�2��c��5N�����4�(��#��y�jaS���]|���v ��qo��1�m�� #�S��}G��B{�i�2������-�?�I���@'�
����&�Mf+�ńU��,�7�������yr���"#����&̥���?�6/�)��%5�M� k�#�h�&g��GUop-�B;L�"e3�;��|�b�������CD/�&
���Ͽ�Bm:��ZR��4ᅫ�������$�A.�LozgB4@� �����s9ś|�U	�_U��)�d������M% �V�E>��G��I�Qz��έ�0�|��GIq����ˎD{e�E1)�/�Ӻ�;����̝a[�끂�+#7Gx(Rcig�}h�	w�F0�R���X��ʡKg?��ݖH}c*�eWQt�H�f���/w|cF�H"^'66��b�D ���/V�/�Lt뚖J�{{vhYJ���-�?�),	GW}.�M�M����P�~a�$�b�7�ju�B5�	%���Aڞ�MU�`�ο��%�Һ@�a��2䊣Y�`� �@�+�Z�ǒ��Z[����� �����v�j>V��~ُ��F		��f[M��y��~X4e:Б���==;u�ʝj]�9؝��R�;<��Z���{�V�х�G�N�F�0����}�V�<� �Q�JT'A뭅�R��8M-8̾�����SG7=[���j��K^?��-�&�����o ��"wx) G��3+s�r	1Q���28�'�Ǆ.�z��b\2҈4�{x����+k���-;q't����N-S7Q����z��K@�W�5�@l��=��Ϙ
F���%���;]��}ER�A�~��NAt\fTQ}����_�jd��H��	�ث-A��#S����H�j�%¼���#&±�Nx��<���'}0$���Ŧ�O�p�~�=t�?�є�;�8��aL��9t�r���5ߓ����bq�RY�"����?����s&3G�?˓�C�*iV+���xRA�i��A!��������@�<��J��NM��v�l:�$��cH������zXȚ�E!�����y��n�n��4rc�q��}��r�u3���̊�[���S��dD����tK���fp@sp�ReXp��#���:S5kJ���<�Ai�/����xiY��͏��b�iԙe��tu������f܉�[�n@�G��]��3d1���gf��Q��"$U��*Oap�N\�W��'z�ʗ���`5G�s<�S6l�R;bP���/f�fmύ,ڕX��؇� ������,����(���|�Ł����MvPYa�U%����%Ƨ�O

����k��p7��cj��ؐn�$��~��e����o�ȥj"�����d{P1�M1wz�׉�u{����:��a1sn	����A��ԮLJ�[C��c�6g;��c�FCѿF�B6��Ф� g#G;D\�O�<���I�5�CA��=����O���Yׄv9��k�(*q:C�oߵG������z)K�w�,ѡ��ݻ����m��9����޼��sI6�91� ��C�X���:�V
�DƆ����ϡ�x�1,�xz��
�J����c������,�2���GR�å$"L�ވG��h(#?�WA���%�!l5��՟�n�I!����C��%[�p�@����&��L�<�F��d|6�x<M�K�Ω(��[�!�����/V��%��8�Y��	�h�]���:e�L9>*�M��T17�'���U��@8����2i�Ԝ[���~fG�Z�w'l0EUB;�C�9��_Ipq�_ˣ��"suЌ�W�X$M����
pt2�����ِb�0{[`���.�{9! �^�
?�9�p�Ņa|�u��M;K��C�r�1q���|�>���O���:��>f'�P�[>E�<c�z�
��m�v툣'��g#����kc�"&�X�l������_���7�w�|���6�P�j9L��%�N�n��tB�3�Ԕ�k�nWm�%�oJP��{y�l@�� [��(]�*np��������؅FN�-�4OQ'�'�9�G+{S_��I:�:Ю�!�{7���V�d�����t��$B[� ��
���=�(*�#F��v	�zr��ICP�@z�:o� �A��Z_F�Oj��9`]*I�+�Z�K�� TiL&�?>$]n�+�T���s�}� Z�v=�S�yD��86t����B4	41·����-3]��n\��fL9�T��k��[p_��?r��Uŋ֑W4�ڙ��_�u�M�j%dk�^J	�,���FL���Ǖ���׋��[��3㎚��:k%��Z�W?=ڵ\o���q��kq<cuZ���rD�yBf�-�	�!����u�w��.C�? :�]���4lj�{D(U�ɱ��W�W2B��9v�n"��}����	%�~�L�ٯ���O�9*.u��%-ky{����x��W��䬰C(3IH��uI]�	�7ܶ5C)�d�u<q�i��g�Y�i9�[��)��� 2��2$��_u%��"V��q�*�����{��,_:��XR�OlQ8gEH�BA�����B4��؏u�����Z2wg-H�B�x����Н;pgr�ܩ ��dHZK(&��*��=�N�uN����k�3����~$l�#�"Z��*�?c}�'������YqWN����r/���ã�17��K�M`)ժj�І���]Ot��g�`TD���l�6��:�jKic��f���:�6s���-��T7����l�ꀛ�`�j�`�mֱN�-~H9�$��ʯ���.�	�ܟR��̑#�����1]XEU���J�.O�S����x�'he��8�O�9�8� ޹9�.@q%�+���uԂw#K�B��a�3��I���Xc�N����z�#-����Q�[<or�@R��cG(����,�Oع�{���ɭ�T?j�J�t�0\�O�~q]�~��zG�Z�JuR�8b�z}B�Is��fLtk�;CR'!%3��S�V-�]�%;�2�ܛT7yi^Q.0�s=\�o���z�`'_a|̟3)�y��bK+J7�w���_ǯ8�(8�,!6���h�WJ�͋�z��u�叇�>��*8���)�FB`J�쨇���mV�;D��'j�Q�:�0�w�F"v�v�����|펵;B����Vd�4��T���O�mqX��]�3�v y��nO��[��ѫ�����c������p��e�8�0���,��ó��d�ۣI���A8|(1k��F�EnR��Oz')�{��3�f;89��q�ޢz�m����a �u�/�'�L����nXJ(��ͬ��La�J��XS@��44����������/!���9��/#���|m��0�^\Sijk?�[<�A�����
�Ԡ��6��g���RT���d\�����U~��VJ�X�RkM餣����졎�t�|]m9��͓�Zk�,��Y[�C��Qp�.C��7�1�LP0� |�$�@��=dP��!���G�\Y�Mˁ�n��ur��/��
I?�:ܛP	O�,�~�@3�*ֻm��T��2__�����Ӫ!����I'tDK��`X��N�P�Hl��?��Fl<��D�ZQ��ݒ���(�:���؛����)5�l�h�!]��Y��k�fP�ѥx�q3���9����&n�Fs��xc�=�H�1D������Q����(]�8%�!.h�ί����&�%�-�{�Ӆ�l�"��~��M�q���u���!�I�L 1�9�]=o����6؂����;�h�D�T���_K���&��L�U��b��~Е֫Ǎ�럣W)�nvд�q��_���-�^��A7�_еc����Vt�d��DE|��7`�E*���5:�*�X��A� �H��k��0�RdZk'U�cP��������⇵�FD���`���,d�� �O���:��'�� �hX���&�����d?��<̂O�`sw�HFB�������G��!�r���}&��+���L#���'�2.}��f�v��6���˔��d���]� �Tr���X��2���s�j�}�ۥ)ҰR���iڔ��#L�Y�ﶕL,�D9U�R�LJ'��VT�𰲵`���M
lQ��<�[=���(t�$��Y��^�p%�v�.��Z6JgzM�գ�[�6���L�gS �i��X���ksjp��U�5>z��6�������ᐦ����/n�xE��w;xeʧr��Wj��%���.��b��kt�:x�Ǚ��#��L�1c�?�t��SO:�I�ϙ���8 R�k�����5�+�x/��{A�-�®���f~YQ��d���o�3yw\�2R�����ɱ���ற�&�+��c�!��X7b
t����$W� �/~��h�z��k�aٕZHt�����	5ÈM�*���2�|�B��V3w�m\�j��CA����{3,�ӷ~5`�u�0��x<Y�g����o-kj͌vm���y�^IV���;�f?|N�	����8q|��5c���U����(���Q�����в�Eȳr4N���u���F�1���5>�tR�E���[@��b�� ��ϢMO�ǃ�$j�C��۔��ܢ��[3��?�dem����v#�H���-�&��n���;�/{ċT-���+�l�yDq}@!7��j�)��D�ob9���v��~���T��L�2�bsu�A�喹o%CH��2*�k�,8�eg��t�-���xf�R�c������Hu�V�5��d5��2�b�ڱA�x��H�B���M��5�y��b��p���˦��㡼�tA i�{/m��+o�s��hj͉��{j�iX��1 4�FҒF<ч�B�mw� �M>�X����7����I���P^��5�eS���^�ͦ�8����������p�_@��l0�q	�9�
����:�Ky�c-�/;�r����tK0)�p���&��R�5��m{�u��$�x��z��X=o�?�\��"K	wF�ߏf+c��GgRc "���ܩ�>LmV����' ��N�}�1�-�A��<;G�۴+c����
��ٰ�W^�7���a%�"�#��}�Mv��]%[��M3A)��,� �z5�u�IB�ó���A(�m�M����S�Ǯ����`�Cҽm�B�c'�U!E�|��_ޞ<�5!�a���k~�9֬���.*�1��ͅ�&�T~|�BS����{��Q��*�T�d*����pzy=�(� ���4�5�z.�����i���yțͧY}W4�+H+S�Me�B�-�BeŴRDS6Sۿ��翈>�sT਴>�O���rҸT�l�]E.�Q�Oe�j�N�0̤��-�`���O,WX"��4�hW2�C���x)S�@M1����jb���Ǧ��.MW����9�����? ��VB?<�����/=�Υ��\ܟK�������~���E2�G�%��'5p.�����l��rU�G�aM�wet6��U(���mH��D���r�(7���!���w�L�zJ�ۇ�P�w9�����puV�+�(=���6&[^��y8 ¯�^��\� � |���?�oOْ��G�Y�"؍�!~	��(�%�xkMIYJ���bǍ�̅��Ɏ:���ӟ�۱�O�&�@Ƿ�
U��]�|ن�Y��,ATJm=U�=�.���$߽��y�x^��C�m�j����6���ހ^�S��X'6.�k��^R�K���#���1����*T�-�ȁ��`r�]�>���G���S�~�AW��~%�J�5�9�`��L�U��o̷&�2`�c�>��t�<�HdE�-�/�*�������&Aɷ��~�,�#Z,��F�f]\0(V��ec�a�	i�w���6$�g;v�t_�j.X���i_��:��|���v��� ������!���>�1,�!:|������I���F"��n��H�g�/:?Lx8��o�a���Y<R瘟 �YV�t	��l.,҂�T����~���3O���'U������Qӡ��oiJ#ڸ�ΰ�^#�>��&�_�����;�|c���5
�E�� ���%ʿ�Fjgʶ���ϙz��Ȟ��PX.J.S�PJbe]�ڲ�ӵz.7-]���[���l3��F���h-��p���[v�����+�3�X����X ��9�L�@�U�)�:�>O�k-f��r��3D|����&)hb���=SjX��/5��U;��@#Ӣpo��ߔߨH:�&� �~j�e�j3�gN�H��vI�vp�ʕhe�9��F� _!8F���W���o�:��4"���F\�(ܱ�/P��4L�#w�t+@%��"��d֯`���+#�[h���4����)��� I�%@��Frկo���h�L�	������Z8c�6����4��&��� �a�T����N��4C��?�2�<��z���'����NPtZnY �¼�I�ּ*�f:��ٌ9u���7����u|�q��n�3�KO����;�G3:���m��hй\�o]��ǧ�5�'��q�y��4�7Sq��o�gJ�g11@�.�`K�o��VQ�!���ٵ8`��#Y��r�3Ӆ{�u�G�N�a�L��G�:a\�3��4����B�:d��~�9t�����\�eI}KŞ	 Յ��4<�^�)�� 5�~|�,��	h�x9.x�Ob��DPՎ�����	1��Gf2�f����	��޳�"��������z�ļ�������ob�Bp�2ߪ�����w$\�!3��b,���6�;Ho��`
�����I��r��g�AԤA�L7��l`����ۅ����K�6�����i_R��'N�s� `��.	���l�B��E/p�%"�R6/��C�M��@ꑐ���h+K}�:���F����X� ��e+����1_V4�� �����ܐ�k�a�[!%���:�U^�p*�W0���2Qޏ�;��������f^��O���4�L#t?#�"���P>VX�`��	^��
ۘ���r����	hΈ[�j�����HD�,r��d�
&�+�����4-@#�_]�I�=Wг$^�D�E�]fwVF�/�:�;^^���wt�MZ�<�#�,������+�%�����3o<���_�&/0��l|2"=J��o�Z$���_dPe�����N� 6|,Os�/�&䌊Gy�q�^�b�iy�#�A񽙞���X�_NПe�P	�Q��D�i�	�\��^\,��]�wP�����r\�oV�uǬ�T����:gк�����SH&;�ėJѱ�Cעj����Bg���c-
rny��}���v���xz��s���<}4��;X6�?

��/�!��D���[T�4Բ�8�,8��#z��64���K?���1�_r��(�b�V��ru�r��~�!��gD����`a3�`�t�<��<)�����(�%a�^�0�DQ5._�x�ȵ�L�#���=[pR؃��������؛�KHouo��Wz?��P�C�>,S���8��Ǻ�0�{i��16�3���;nh����Mҷdz��;6���h�P���*b�_t�SKgw����'W2���G����<�O��G]�ʂ:e�cs҂���=�и�<nUi'�o�w5	���;�5Fpp8k��0G���Ur��R
ޜ��*QC)��K�LU͐�Ǻ\�������N[5��䶓��ڐM���X���4d@���W�F�ui��F5-*a)&���ص��9%ow��V�����"�Ks���:�4-X��}䢔�ҒcP�M���=`���z\,x7��"�X�EJ@�/�D"�֮u�Kw�ܡ�����lt�^ņy�Bj��,��K�R��a /y_�����x��@\�j��m������7���o&��k�g���?�Ѧ��@ݪ>J��[���;#ċ��v�砶���:fV�yK�.�=���g���gж���*�� $5�D�GG��zi�hq�TGɡsQ���$a,�iG�>�-� ��t�_8Ő«�7f��&��,�'w�����O�����Kq�Ҹ��o�*�z���$���xLN5,j0|~ü|�8�B���+�(|"�ӡ����!�e�جh��>�e2�S��M�ϼ�k`� �x��0�sw�3��K��C�Ou�!�S:��H�5�6��M��f]I��!I��;=��9��[�� ����p!��Q�;�Ƶ&}�u�w��O��o��e�5��PSR,��B/�t=�ה*J�yp����-�Ք�mC�x�b�_�@jf��d�õ ���n�)1~�τ5%���-��=W[�)4��D�dа^�Ҧ��Y@6d�P(\3xi��3���!	��@.����xϯ�����m��zUɤtT�>mQv�{�\3�RF$������>��Õ5�a n�=ar��њ6fz�ۆ��q�@�
��1N�H��.��Z���T���kd��/\�9To�����s �l�٤z`��V���˙Ab�g���JP2���h"A�k�%�T2�ӖO�r1 n3k���P06/$��a{-la�@�o�9�N)M�9C�6��i�Q���NjX�N�d�6�t�Ĥ�S��	���W�K��ϸj*��q5߀�3ܮ��d��r�?��^s���F%�W�v��Ɉ��k~J��9h���	�)r݂/��B;�?�M��L��[��fl�Ad�Lg/v�Z�5��k��	��ƙ���|(|�5`.� Ia^��˸P(���Y�y��ԺY�(o{F�"�����}��X�GH1W�b��;ak-���[_~���B�߃X�	xӹ�(fR��&JI��ɾ���RlJ���h������_��L�t[Oz��kj�4?�$�-M7]C�D����ʖ|��r�	�V��Y �!��Uero͊�	�T�hB�>%����g:`�KiO���ZM���:����mY')�m�r�J����3jY-�S܋.���K�Xi�fӬa=�����C��"Zu�UN��̂���1�ts�m�s]�A����na�4ղkQ��b0��[��C��:<9�Xc���XŴ%��S)��c����O�����ѓ:�m�d��,P�8o�N�m���
q܀�#^�]�5T+�t(=Nd���2i��^�L��X���~_I]2���H�d �<�dig�.�i'���_�Ĕ�I���q*	#H�J9�
)�����u#��r �q�����b�U�����5�ԙÑ3��"�h�𘡣X���Q�97��rilg'v%֠��M�쌍�F�E��~(A�[Hg�4+��Y!k�e��7���
��oP���m�?Z�bzP��s��!������_c����dd�/�W^�hd����e:Q&���� �Ge�RοE�����V_L6E���g��cqH���g�a���t��9Wo�~�1r�X[�@MjT���u��c�LmK�1TR-�M���>��ޝ��k��Бk��x��W6-��e�ph��XV:r��)s�;j�4,ug'�zk:�E�Pp.�R��}�M��X�!��FAz8���U`1c�7I|�����R�ś�w��c�2�7<��u�h�z��R¾�r�����"���_�V�8낫V�UZ�i~��v�1�$a�Z���ɝ��^H�����Vd������9R#`��v?PG��V�����e�������h�e�)�O}���'�*�̅��j�uNnC��}����yZ���xI+�mV��z8���	8HD����1�t^�$T�$�����g�Ϯ0/��}i%�s��(�?�������F�i 3�+�����7��X��CU v��%>���@�[61������5o�h�pZqC����I��~:���nP�� �7�` �%L�ł��o�??5ǖ�.!Tg����#as$j��0����7B�	8z����/^^��Qv�tuTP���rdmFK�+�T��\BL?C_5nV�;zv�QE)��#��Nܦ��4�8f)G~c����m���ڦi?儬����]y�o�K l�?��dZ��_�$%�r=���,�=I�~#�G �JFar��ũyc��.�!9|�T�lQ��{>Pݩ�ǵ�H�|Nר@4�e%��Cj�Z�!�-��֣���3�����/�8j.�
� �'0��zط�F����gj!ŉ=I�bh�9�mV�yu���*w��Nq���1���0�0k64*����2�<�[�U]20���y�������{�3qx�Z.��wrD��#E�x�,va1cq�T�	S�p^�O�,D._�J��l��~�=^QE�#� ȧ���w����5~������P��9p۰  и�CqS���-Ƹ=�5�'���bf�x:�� ��N{,MGl?l�H�@I�����+�"���Cu���\>7��=/*�Hmq���=��RF�f��)u��9:v�G���S���oH�TU�|��F.���B�7��QT�~�~�3�̃¬�W�c�|N��:�+0�#�R�?q�^��n����3�ջ��&�1-V�{��,�p0�4ӝe���z�c5Jg���k��*��`���>��5�h��D"��*�����G����E�]�P� �\3%�,��s��0#X�kd�����[���$ʵ�HO0tX��Wx�8�'�	J��/�W_���ܗ��kg~C�(�x~�Z#��n�6p4�]��D�o�0���:&����>���-)�%f�����*�C�y
��r��+-V�Ji����!�]�_�zi�xgG��^�����0,21R#k!���v�F�[��b联s5��c?߯�b�$hC�`���^��=��iv���ݱ7���bE��s=o�/�6}�f���c�#''����W��ZN?�!^L����x����)e��oh~��O[���$�@�<�Ű"lL,^ �Jp��uS �|3V����+o�:O�☗�'�X�ğ-�j{9��9���/Ϣʲ�s(�M�M|~�JM�)MZ�!"�N$h��.f���9��TE�����z��ދ��n�����Hv��-~#�M�޺F��H��[���hQ*8�+`� ;���!�����)��V���#�.��L�Q\�j�"���Q���M�4W��\���X�����H����ќ����Ɔ�U�X��00�k��x�4���'��ZJ�@�V�ǧe�@q]/��vy��C;yֵ�u�.�C�,쁛%�U#�OUqV�}��up��Q 9��h���7��s�o�|j����l��^|�
},���L�v��y���������-�9�2jj�V�*���2�J���Dx9�v��˼�{��U�Q�p�?N?��䣉P�"5���[�W1�����b]�i|֘�d�ON�Y��C�CN���&d���0�U���iܥg'�rÈ��P�s��
��&)j�I���A��~�(�h�x�������������]͋�m�&~a����6f�}.��7��iv�PX��j�El���tg��{�"BGLXk��G�*5��
0��q���t�l}��Xa�z�R�rAh��#�^��P��!)ބ��D��)��7* MIB�¤�/��Q��x��쑯뫟%RN�q�%be�@�Ѣ���`2tn�U"�2Neo胰�������`�ڐ"��RC��$�
cƼ��J�־���"���0il�6��jQF���T���c�漲�]�����Ŵ�9PO%x�l�����2jx�}-�ǲ�����r3a�'Ꝩ�(q��{r�/�P%�}���5��
8sM��I{��u���G���|��]�B��a.�T�L��A����Z�z�|n�����^p�X��C�����؈�A�'Do�PJ�/���������z��!~Ght�n��7�C��ׄ;��9?�n����-s����~ICA*@���Ci����&#K��]�_���;c��ƈB�9a�|�۶����U�� ����,��+�oW�򗝛.#�.��6�����tk.翍* ������?BD4�R=����Rů�k^�&�v3�_�����6	�t��3y���x�{ŀ�E-ژ���d1C�EF�D��D�rfu�N�Q@�>�$sh��~��6$�U�����$^)���fk�y�/���c�W��"����c�.�Ц@/���A�-�'!&��O�X;��>���]�A�*���F�c6�s��-QǓq�Lw�fQ�{�ԴB��Nx#��p�RL�ڌG�X,e��gm�XM/+d7����x�s�J����Y�5�2��M���� U�a���Z��R�Qӝew�U��Sf�!�o���M}���m:r�0,MrP�@��(���7��)B�F'��]��h�/�%O!W�n8V�yY���9��G6+�H\�L~����vC-ה<|�*ɷd������H�K��e����y��f�N��l��޲��N�BP$��S&8�e���l�$C�bM�ø�'K�f@�bI(�:�t]��XXL[\t�=��8	��h� Vڔ���̳|���ߩ$ Q}��.anG�K���f�K�)Tb�/���	�8
x�r~@~�pO=��R֩e���^�g�Vc����J�u���e�mB����D��T��J��83����e� �J�$��e2]�-rK�Ķ���A���[��9O6�z��:F`ll�_��E�O�=�o��3J�Qn������x*�_i2GȺ*�����i�1k�����=��6�e��Hw} s��wq�����7�$�%s{�c����l�n�k��3'�.�|Tm�	�nCsf�|��ng=j,>$���CY�#�������놂.� �]h��Ȍ)�4�m�Ik�.4%K�m����:p�s��0����޲�LOHB{U�� d�^r-g����ލ'i�l~�ӊr&�FƠy������$TS���~�nJ@+$����?s��%������V����w>���Z�G~�@go����h��ap�O(���#j����l�2�dpf\���D[����+�3]�S&M/��ۥD�-1�����/�HC�	m�<(�J���%�#X"4Jm&b��s��1�<1�ݥ�7X2�fc��J v�0�4-ddȘrY��43����Q!B�q�(Zy���n��q�r����.��VV(�g��5�)s�p�A���edq�[��2Q��Y!�T}��7۾i���nk���%�<S�UA�h���Ʃ/�-��a�؏76]V�������|4 ���8��n�sc�����]"���ۄ�X(�p��P�M^�!�����ٓIZ�{4Z��G�m[��u�a�'Tl���m��� Ȝ��&f�*;��W��Y`�A6�V��5�nO���Y�+��d`�	_a�X�.���5IP
�eRCSK����%CRHm�+D��z�_����
�췪h:�>&K������t�e��棔��ؖ�����݉B��m!�6!��p�UM0�4�O/*�[`?�Ƽ�Q�h�rLIc.�v�̰e��1�h���r��WW}�-���)F��*��H����E��%�Z���9�\-	-��5����V��2�����ܰ�aY6Q����V%� �px�	
��⒦�Jn+��3��6y�Z��Nv���p����i��>��0Q#�P?DDޫ-YD�]��z���˃g_��"*�Ǻ�c��KGo�FNa�~nt�5f�Q5�������RB�ڌܽa�7��^k�I�pn�_s��������V6��
�POW��{�������O[�����Roq�G�`)7��I�6xG�UUV�p-/��+S��g��wYn.qDQJ��*k�� v�����m�cw����i�%}��IRA�[Z�����ب�A~�������%,��`{.RE�g�?/�U�|c���T!�M�<���
1��U��$n��H3�p@
DEUP�jh�֏�aX:k�b��!��I�ě��y	������F1��}�T��HPY(/�E>ܙ��}�vx��+1ޮ$1p���:i^꣢����� �v�V ~0��A2�XV�Jr�I;���'�2fz"�Ѫ�1jA�"F��i�?0�6I����W�<)V��H;�����KrXw���7H��X5r��^8q2% s�lXg��ZS��\^��>h<��Q�B�oP?$��K�
�g��>������=}���Wml�I�{॑"!Q�ݷ��ܤ(s����s�_���z�{��*ο�E����.��ٽ�����r�8��p�,�����E�^v}�M�sM̲� X1���IQHV�4��ި��j#�kRF	��N\4��5Ռ�^QGʼ^��[�����`�����M������ N�?�g���}�a�u?v��h�;��3e�WC�IS����(�R�V��^� ��a0�W�/�o��/���V�B���{"͋�5~����p���� L��l]ؼ�X{qb�86��.�w�PF��?��P+	4����&�Je҄b���"
�������ob� �{E&�Kx��_���Uf�e�g�liE��������<��6�_S��ے���n����Đ5A8�ƞu|ߞ�bt��|��o�SuAJ�J�f�h�iKx�N���o(M��X��_���"]�̂�����'%;U1�������F}�����Y2��,�����yJ��	n�w��,cW�g�t���?�r����f�����͝~(���ͼ�	i����� �w�<9n?�\E����������96����_�������5;����}�����F��ǰ���� l߶e��W��Z�|y�����<5n���JE�#�bQ/� ¶'��H���qc$>*�|)�R�rN3b���l�k$��K��
7���Z3j6��SN0�#�=����>���W}2kx'l�(x2}Q�z�6��=���W�(f�G��g�o�M�P�!����d�TSK���S����ݡt�l�.������]"���/Y���������[�D<^���>(��c���g�׏-H~��	��1�Z�Tʤ�QŰ����Jk���I�C���<s�20ڻ1j�	���gk@�����؃r�.\�tՌd~�=����C4���>�^�J���i[�<�8-��T�k�hP�?�
\�����>F���~>F����%��mn˅j�냼		�ܮ����za�[���"���`"z2�Yg+���z{�lXш�z���Mo��ڊ��I+�	�g�����[Y锟��ف�F��Q�Z���}k�o��%|�?����E�C����H��4��������}n���ݐ�Ճ�G���<���U2^��r�.��M|���6	dH�_f���0\X�:T�">;t�x�����']�D� )=��n>B6�'��O�}�Ɏ@{e�<]�h��'/Vc.���(��m�I� %���c󭑸'Ժ����ah�g�E{��dG�z�vF����6"�UV�2���N]�4AL��H���������$p�&B�	�D�V_?�����r�R�����>4�[ʤl�)�jT����@�Uev�92w�� ���D!3�X�~��CX�>ӝ��!?����3�p��'�'*��
�o�c�x�Ҍ�Qj�eBֱ�����+������Q���X������1�՚_���IO�4��Ŷ�����O�֟zr�Śm���C���-�0��g~�!��������`�j`�8<�l� ,b)������f�9�;����nj�6��%�<����z�lcqez���%s�qqwIE�3nA�?3;Op�p��LS�ӭ¹BhM��rGpâLF��x;)�*B�=� ><��'
����ReZ�1����`J!z��T�Y�tj��?$!�c��pW+��"��R}����EEp�xC��-��X�h���|X���\������n	���g�&Wh��)]���K/��ܮ��땬7�c�\����ˇ<���{�P-�V7���#�kS���83N�H,2I�{ ��ܽ�X�1>�{��y4�|dF%v݈|��73Ȥ�~Y:��ΤvQ�,������³��U���!maJ0E�\aۂ� zui��F@m�|2������#Pc��"�6~��A��>��Z� �W�h%����_�5�Du&��ג��?O#����oqn��Cʣ�q��)�x�*�駴tК�f5�^�.c����쁺��C�!���� �%m�eNZ�T��Md:;$�]� �ZN����*�И@!&{�\o����_��>�9�,�c�/@ə�쉄�/Zrf���q�}@|m�z�!��s�"{	>J�M��p�"a^���$9?����x�~h���Z��zU��ȇ��\��Mۥ��Y�%�F�����rBd�^�hP&ɴ��}{Ձs�H�/�O �����lA�m����L��U����%�1>�a�|���T(.��ت�I���(z H�w�M�Kj#�R�q���*7�S�u`=j{�I�����I�q��H�����\�JYZsh��cC��������2����$>6�-�����g�7��1$�q=+�j*!��bWpf��ëD�5(�� ��&\�6�TK�]@��]w	A�#@� �Q�Q����6S�$�a�͍�΅B2����t��ư��l ����"<�8������	��z�d
D?FWT�T�����7�I������F����H� B#8]��.���k�7�K�v�cL&��g��U(!��"�(b�F���1�E}V�ܐ��ވd)�1�Bs�Q����|��
�-5}:0��c�Ƞ��O���p�����׼k4��	�~Eyd%�ߢ�sa��m�*�K97�~S�:T�1WKR��s��9�럃P�w5�M�����P*4�,��Z%]u �M��������O�����(��g�#��$�3�X���~�Q�rS�06.�"�栎x�A��1d�%�_�7��߫%�c5(en��=��|w�.P����I'��N{�I�/������+��&𞸈�y��[�\@��z�Jj@��3NѾ�[:A�Z���@X(�:aC�f��Q�.�;8�8���+�x�޸�x�<�r�S�
 �0v���%S����Ց��l@2>^�Œ:�$-�r�;��"��k����i���1DM��J�N�h7.����޵��S_���VjL�����"H:Jo��D���3��T���k�Tqo�^W�k�b�tz�}\���͖��E�]�P��^'��kOz�)�/�v�=<*_*u��H���w骞�3o�Y��f`ք2����<�\���z#�a��9U��-���V6?[p�V�sJ��$��a�z�k��a�(� 6j3q�mybm�o�W(���1���/�Z��zw��W�M ����amV��� 7�u��ؖ˥�4,�lSq�Z�N�y�
Ȑ�A��4X틨�n�ڴm�;h�X�
NM4S5��B���zW���N&�濍��f1	�V�[�:�P�[�f'��5ݵ����,��Re<�ZSx�D�� $�ǭi��e=B~9�N(+��(
^��K��w~����*Sչ���y�^��=;E��o�oCsmN��W{�Hw��b�$[��s����5}V�5�3��	�0��%�v�7d�=��"s¡����X��=��E�l�2���vǟ�AVd�W��g��+�E�u�����������*}U�t�WQ=?3M���Mm0���^?��}��PR�]�7�2]���OZ�`� ԝ���SI���LeM=A��	2���֝�٢�%mG9H�&�U,��2ɻ*;bo.fgILp�L�w��@�J�<%�9^Jǁ6���<]wL�FW��T^)+&��1���]��F�؝�Y'�nU�q�
�K2��(|Ѭi	.���۬4����������r;�O�h�n\��E�^�m�Y�Y�ַ�+8��Vf==(|���U���(�%�$Ȇ��ʞ�]�P�n��-��Y9��C?��Q�a�p�cx�<��a������\�iål��|-�s��������yCG-��h��s-�R���=?W�c��C����)>P\�0�6̔�/k�c]�@v��a��9i��/#�ht!_�́����f2f�2�W��B�CG�J܅��g�Ý��y�zC8F�;7���7�I ��J��.@w�6K8WZ��H�@b0F�`;^z9�?��s�JaL�l��x�O�ҩx�];ikK��cnt�9�t����.g<%����)�T�Qd�>���� |v�j�N��y���������� ���)�
,���l�C��!�����������G;[����RލS�7�c�k��ۋh�ʝ����.�� ��'��h^�&]sH�i��-2bv�e|�]�b”B�Bs����W�K���tw y}.��tuW���g�R��_{�2�P��	 �}=��g����IQ(�#eA�S�'[�¡�Q��
���٨Sd��|~�
��b�ww,���P��$�4è�ZK�4D_/���Giq.�#:�T�y)'^����`I��6���?�o�Z\��b/��٤/8�f^k��n�4Aj"��D�:>fD�Р�Ϸ�ںk��8	�c�����בd�� 6}�([�"�ͮ1x�K[w�o�!.���Q�ky�u5wG��B�ve��,l
�4�иh�0�|[�Y*���ϥ>/n�����.E��W��Y�=2��>���x~�4�kh�*�X��ᡥ7��u������<U�OR�e���ua5T2#��6T֮�B���!��H���9+�?'�����D����ʱ�4/9��(�lJа{�"��)k��|��T��-�����5�N=��k�v�u���N��y��O�x��|es;��q������ �50��B�[��M����Y��z(����pl��H�a˘yQ 8��`:q`�4� �wu�ֵT݆KNjť�A�W�Xh�&���,�Pәc�F�֢Jqi��޽s�F̻K֑��"g>Rk(�����
$j�RFO���bT�T���ʷ\�O&Tͱ�ӓ��<�
���z��X�VH#���N�"؊b������yt�;��7\=��;vji(�'�z���4s~�I��|T�>��N�u^���f((c��࢞�*z�.hC6� ��'ȕˁL,����5-����&O�C]�v��P�QW��gTMx�5#:�o�k/=�9�M�\���yw�2���^'"Go�d�O�X���3��>2�C̎]o�_o�tW���,P��7h˃��܏�\��J���c��R�T|�>��t��G'Ō(K�#��h�;�V�_s{O|!W���A�J(	IPh�MU1��M�Ԉ�5�a�� q#�'U_a}D�j0R�D)I��_;C�,n�k��SRs�K��Q������\��V�=߳�Uȱ�����XvQX~��:R�;Ղ4�������h8�$���Z�ǅ C�����g��0r{�C&�@�^K���G�3g�r�?����A*�5PG��,��7V�~����[�A֣�)T�9���o�@/N��{<�7L����Q��L!����)�C��m�e8��V�E"� 8;�)h���Kx+� ���ʨS#�_=:��(��x�Cy�*�U�-�0:ٗ�@N���:���m��43#���m���O8\2�L�����`�?Ϗ���z����ŨJ���_9֐�I�Yɳ�i	- $����[��/�q�n $��w&������ʹ�J���D{���A,���x2�֕e��:��߯
uq5����+%�B�(J���F���7E�	pI�hn}{�&���(ޞ�[�?����hh���U��G��!�/��pQǎ��0�Y)NEĶ@
>4pǌmjА�,u
�0%J�.¤�vR��W/�0g<�W��uß|���a"?��LGg��q�#�����	���M���h���%<張�E��2�����y��~0��5.�Pu$gZ� N?3�sv��N~��>�UmDPV�F����C�e�!^��cn%d\�2��Y��:A��2�RP�+��]�����$?ϔ�
����ʬ\i'�$qm�kϠ������m5u�?;2��bcJI�7�3�4��͐�&��&l,N��\���I� VvA<��@ʁbjJ�ʗ.+q�HDjPr�K��V�b���Ѭ((��uhN�zݯt%[����1��%-�f�]�)�S�&7\|�Q�w�ht�b_��-G�8�zɕw���J�xL���Ө�.�(���P,���o����1��'�D�CQtK���%n�����-���D5 	j��U��~"�VFO�F�MJE����� z	�i
�c��TK����w8��tFQ��)ևq�o��[����K]�k/"y��BO�����k��_���)�� ��i"�����nU#�S�V �҂S��	����5�e��GVY��sG���v���V�֖@�
����Pt��؇Ԑ����ћ����R	J	���B펅[��������3�PK��a��4��uX�&���q�Z�41yvZ�{qN3�Ji��9����+�5�S�9۞��fۀ�T��^S���/wx� ��1�+���~ ^7��͒��e��In����&*�n��	�5g����M�o}
3�W��t� ��xI/4�C}���W�u�G#][%�!�tD��|w}\>�o�T�ZW��~}&⭻?=!"۩����+�V#�⸒�+����Jͦ3'V������;����:@3L/E��Z�nӝ +蟵�f�jM+��n�a~BGk}�֜�uP�a` ���/D�����+�W����������R](����e���)��_��	``w%:W��1.�Sr�|��ɤȶo��
M���1���rY��c�m�Y��4����D}LP
�̙q��z�C�كi��vyx��wu��?V����b��c��S&�c9�����.�v���%��?v�A'�a�p�Z�9��ʁ'�4 
;������q���㏙]��1��o���iP�k���MX�y�Yb˻�� �M��y���J͍n�{�R]�^�o���Bc���Z`̆��UL���K�ҲLƧ�{]T²<:�.�s�ra��җ�L��,Z�ޖw�,S)l��g̼r�r<��ю�8��l���Lrx����v���_b�����BN�fr�Y%�j��T�5���䲬V�&tIV���+��h�ղ�9j�Z�Q�Nx���T��7��z3�(�nNL�`�,1@%����]��5����c��L���ӋQw�JHn�%G<��sf�T�\���� bE�+��l�Q�H�������&_���&�����r6�j<c���}�-=^8�XO�j������ ��ʇ�M�4�	�W!��~g瞘��{R�jj-R�O_�& r������?�<�ﰔ`�<k7Hx2Ėn�j�����,`�pX�n.�m/���@��r�>Ѩ� �^�/�>��}���L���/�x�y]$�/�XN�Xg�Qs��Ɍ��͈%,�Jk�f�ز���;�HO�Ő5����"y��$��c����]���E����^��l�l8AS�q�7y��Y.GR����oi��9��&�����JIN+�t �P�{T�vc�EO �x�l�����St�߽��d���+9i �}bN�Qs4G����M'7vo�9�ޤ������4$Q�.��=�c�����`�4��꾅l�	��!\<#��p�c2��e�2�e�>��َT���،����d�������uk���g�HK�o8�'V�|l�<������v�Kٵ�Hf&�����ձQR.@<6�NC�Z#�E�t��&��=�j�A��6��u`s~{�QT�G���������OC�rJ�aR~A�0��b����}#dBC��v>R�y���F�l`�J3�%ھ*b;���.�k�P�If0U��0�h���F����|������'�Ъz�D���(�:����Y�d�e�n�w�6|4oH�e"��d�G�;FT(�=�ꨙ���%k18�Wq�lB�|)U t����Վ����wQ��R�_��M׺���hj����ow4>@o�=X�k���h�&.��#�V"4U�9u�h�&��8zӦy��/�yЬi(�1�	�M!x�Q�>���o.{��:�bu�V���#"��?WۤC[�A�wL�Q0�iF����I��^�;н2$�4���ՙ�ʒ+��!Ph�aX�d�T柩]!��wˡ�{���du�נ��K�<%[e�-�G�ڙ����������U��|��U|��$#T����3:�]
���cNF�i�fn��R��F����]���W�A�t����mn�����q�ɵ�p�#q����v\V�v���V��Qe���}b-_/߯6����sn�7�w��"ׯ�5fȗCPw��d�	����,��ۗ�98R�������Om�jy#	m��S
6Cqn�5U��h͠E�ni\jhq���:���+S���beL �ɇ�kD��?����}����aum����4�w�Zm}�����P�.
ݥh?wS�M`Ȅ*��cѲy��L����Aa��(�D�k���y�u��kJgY7a�08��gJ��T\I�*��Ń����p�r���*�[�I��l�x �n�������mAC���9̅�,�5dԷ��������ܐ�"8��x����T��Y� YB�ħ�d���S��7)a�&�G( �cs���>T��j7�ⓟv�,=�.�0���'~�&�F����'�p��������L�0p�§Hfe�y��9�G��h�d�!lS��t|����1�By^g��.)c!v�����̹8�/��H���#g>^G-t��oS��gQנ}xi�{�M�T['�gC׉�����Z}���!Uy�Dl8��"�����<UՇL�\�B���Tz�G~���,����&^���ǵ�ǵ����oN9Z�@�,a{��qd���Msc),d��?���K9`�$x�[Cٷu��p8ǫ�s���Vɢ�z�9��������w�U�2*�Q��m��X������DD0����r� Z���FTR4��`�����_O�ЁLa��������lg�=^S��H��o���l-��R��/�����1��H;o�xN��r��qӳ^lϢI���1����>-�1��Aߤ`�ָ�����t�a�s�M?#a���w:�8�`鳳5v=y�^m�9yS�b	�g��t1lj���ċ�qi����R�Le��YCU��tm�c�S�!��AH��Wi��'���r����*�c���ブ���_(��P"9�����d������o��{Tm��I&czߪ1�/��^ �G��'"\I�Z27N �k�N6�KTv䀚��\���(xhǿ�m�hC]2	4�9���JJ���VU�����cZ\i�6�f�"�rؔ� %�|�iq�[�
$�� {��)^�����t��1���ۺcZ�c
/פEmJ�d��T���ʙ@D��"������F�
LEM�0�梗(ʄ5�z�(�R	�Ix��s��ٓ�,��e{���.ΐ��eK�����1)�e_�gP��1J�E��k�=ȡ|,��؈
�sp)G�(Q��nup;�h���l�.�/���y�Tm �3����n��gP���t�5<_���?g����$��ݖ�|7Y�[y��d���}��V�x"B�4��6���f�Q���.�^g��i��[��6�.�Un'#B����
`9�P��	��nmȁsp��jF���cҐ�zK[z��I#@f�+
��XD��Bv+$.��l�^	�C�����A�V���:���bl3��|�݇�os�D�ܺ�&�N/��X<�I3Ȳ�|��ï	�;Ѻ|H���������5ԑ^�ձaⅶ�D�]F�K]�=v_rv��`�R�����QUv�|��f3�q
������6>P�Mn~��q�'C6�
�6�-to�P��R��g����QK���*�r�06����0ϖ>)��o����{��I�f����AQ��vXj��_��� -�|iJf��|w�H�HuD�ok"i)8�{�u��ЍTt��c��#�=B�}\�րܸ��W�g���W�}��2�}%�WL �f+��ස0�c�Y!f�6�)
ӌ�3YD�è�i�"e�����Mn+ �h�����`Ă>�g�>�5�fpV����jS���%'̘��
���e��&���9��]�#U��37�wV��m��8]���_g�OC����A4/��
;h�	�^�4�h�rÇ}b�R���N��{�9j84�� ���o��n���g+���5��Ȕ����[��m�[�K婁���%��n��j�"R�$� d��O����8I�(t�b@�,߬�AKP�o�T��pH5�Sק����S%"�M-)�Ÿ��#q0���W���RHC��u�H&�|F m�i�]�������h��L,#�������ᷜ9P��y<24�p'��b�2a���	�;��߾2���~�qs�>�}6�3wO&�?F������W@��q��XL���?�c��*���JzwB��P�t�~"�&5h��ZnW��REy3l۱X�?����j�D� 4�&­,�"�W�QeQ �\���1�?�5�ZE����\�u�5w�����7�e�b��|[n,��v��-u��z���x�9�m!TOE�"�MFSsk��A��^�<��Qk3��߫n��=�رm�V����C�i�ƒ����ÿ�ʛ��;�]��I���o���6���<`Ղ�QH��������Ko�$�d�-��R,�5qm�ךA��.�քBCa��I�-SG$#-W��Zl%��;cΖۺ�?ƽ�Y����>̌N���L#���s�M$�;e�	�������p�ppw
Ko�
��B�Sr&!����s�j>~���B���g��zf1JˑuRU���$�<k�i�'��Oo^�'���#�n�|�o�X����]�4�:�]ό�R�E4�q s �t���_��K�!�k�*:�I�^�+�2�-E9���QÀ�E�f�H����(�B6��tPa�R���d�}��%"���о�AF�4��Q� ڈPS�J�s��OQqh5|�kC�]�"杝cAe2���Z�I���cj�y=��Xv ��D���]��ʹX�ψ=���'Gv�܍R#V�}�Ť�C�`��7l3�Q����C�}<��h��h�?b�o|c���²h=B�۳�\�ZǕ��㏤��M��AM��5Y�4asT�!�t�z��}o�����-< g�(?���F�c��3��
�r+��R'*��:�8���)�|8E���*{XN�)%(x�O�U~�o�s�W�Ɔh>����,ڤe�͊����AF�-���݁�|�Yc��ܺ��=ݤ	�Ҕ�U�������__�h>gLQʱFu�!F����25��n@A�W<,\X�gr/�h�D��),���X|�^��͕�7�!�'&��_��]�^NL%v�x�)y���d����4�$���0B�Hev5�c,�����d�>K��Ll$x쫚�S��&k�:��w_�Is���ۧ�����J���w4��3���:�*���=�
��=�}y�c1�o�2�O��<��dM��9��[��i|�{_r��m6��I���c��g�N�[�p�i9�S��4��/e(��%ET��Q�u����.oV��f��qt��4U=ɮ�J׽�1�"����.��9��NWGA[P��}{�;a>�*�Z��,�#9��o�.p�	#�3�0#��-�;F�G$</:�$D�=&�i��s9�w��{��>K_+8Ӹ��NH7Fui�Nt.��>Nֱ���M��0�
%���yn)c��6���
m��c�3ݙ�r���PM�����X��Ra7��P����!?�J^���S��Ԯ$�S�[x�bn�Ra�~�q(�f����/*�T��!<��$5�N�2�6��E�,ۅ���f0�Ε�FI;��1L�P��t �����0�M�~0n�{k�:\ڐ ��7�p���9��,__���K�a�sy��M�}/=�0��6��q�i�{�Q�#�r����G_5Rÿc`2|�[ч-�O�-d���pV_���.C{L�#x� �C`hjبA����2�d��n��K$��fC���ztGR|E�Ҽ����5��+Vs�U�pI�����ti���-����l�Ӫ�=�~d�2B1gObc��ˀh��Ur���t켡Q�^�91���1I� ?,��{/ʹW��|ݷ��H�lK�)Y�k���ɠz�!0B��QA�����L�j`[֝��kC�R�~�j%0o����������q3�j$󎧙�;q:���ƭ�� ��r`�-�.'�is�*��z3�h$"�I�ٰ�ѿ8W>N~�
���X9?�HЇ�%&E(W�WbcB=HŦ��q�2J��NEmۚ��W_�=��ԝ7˷⧌�X��&in(A���������y�z��λ�Z�u�q��c�<��_ک��y����ì�zPH�5� m�� 9�>�5��e1�jWh=��0H�|�mc&Z��5mc��q���	����:�0��n�v�*M�ެpdVR%��
j�tC/A
������f��3:�hej�ӸW�&8 ~���~yx�s�eP|)���)�X�G�U���:P�4됽G��6�('���IԾ�QK�ND���@7���!�b�l?�%�
�<`߁@�]���Gu�×ޗVgΖ�y���'e�����Fl�r!��yX�ϕ�(��ڴ�D�4�����t�E�-]4O�*�ҟ�e%R� ��ps`P�$�	o�E� �-�Ra|�8铧�'���Y) ��z��V��;�U^0�<+���@d�Y�ߧjQ�V(�# ��� [���n���5|ifE>�b���s�C���|�%X����ZeN�X���bf\�����~C�K�`��콓k"Gq�O˸�����{D��[X�&|���kv�H�A�2/���tO%�q�d�_=��4�,�ؑ�S�c�8l[e� y�!]+���q��2H��Ѐ)���票�C�Ӑ�r���\A���j׵�	�	�8��R�2�s�R�a�4Y>���K�$��Q*�9&��B��� otHmNe�m�P�'�5�VP#M���'c��&,:C�u�y݉�!͒B�6Z�%��|)�`&mC;�?��n�pQ+09[�vX�5R��^��2։w�MNQ�ږHB��Σ�Ҧ��ѻ��}�_�~�#����S⭏U
.m�[��&wKXAIu�6��uQ!�)Sd���hE��K�)�pO{\!�Xl���-���٥��d�r�1i xo��}�,r��v}�����C�$C�t�;��/���'?r�>�ʘ�#��m�~],�X/�9rV�1�b.��n~��0\#���Le_v#�a~�'��)̃h����$�[q�O���7��RNR���e�P�*��+*����ʵ)k�;���L>⬵�#Sd XƤ�a������\+���V�N86��S����h���Z�8�oLT���Y����Tp�D��ZL�1-��٥~�
f�Qhv<�
���_����-�
����IOi��ޕ��U>첊�G��.��
�)�7��*�r�N����<rW�>�I̓�ȷR��f~���!��ҵ��KP,�.sS��AcR{��H
�g�b�~����о�%�J{���ő��6��X��>�U9h��ƴT�=��b������a,�a��f"Y���F�/R�X�j|�c#�� t����u�iBY����R�(olDy�`L[�.�wc��+�y	����c���d��s0zȽW�-�:�	w��+A`lb)OV�;ʩ�6!�c)�s�8v24��sםS{��nE�%v�蓟!*��!��/������~�Ϣ>�ou���Ǳ%�Ŀ,�t��E2Z$�_N?� T��_a��ik�J:q�:-�XTp mA��_� �3S0ҍЪs��P[G�I}o����:��ٟMlG�d��ђ�D�է�����w�wa,Ҫ@�q�%��J";sud���.怅��.���?�UO`��ݟ�V`��Z���U)���*�I�Ӄ?k�,4c]Sc�&��K�$���M�/���7�B��y�od�H��8��Ow��/�Ζ��#��~K�
�]���G�J�vd�u�6�/S�ƋSWv���%���\wR3��gu^�`-�}L�mH����a7��UV�B^�)�v���I#��:�Є����}�n'��c`�h�[ߋ<'8_��p�m���\d �W.����XX������.�:XO S�lkPG7=jYC����A�_�@)���&k]��-�dWb�߹�GP�����3�@�捩�.x�Ӥ%�ɱ�1_�C?�$�P�#BΙ�vSiC��NU��_Fg���"�|}�W�k�:u���v�>Xl��g��C_��h���N���Ӈ��2�STkS�������0E,��=e0�xe�#����R.@��UuT� �1�\���)c�APl����>Ӄ-���I���-<-�2��fѫ-�N�
5��(1�]#~�<�	�5��,��ԋ��W���*�4^lA>�7Tmɾ��k�r���&��Yc)o�ՐV���kL� K� �
{G%�t�2 ���%��c��
i�ŨkȬY�9�θ�Vا��a�`y���e�c,�V{�t��ٛ���dKT�5ߟ��DO�o�m�*���5w����`!�����E�.���M�* "9��"�	��_�p�Y���7�O�� ��{�6�ǥ48��(�s$�i]|�y{r�6#2 B�@HG�(��5]���CtV��;f�a��������,n������}"b��f��,7���W	B°��@% �0a�a��������/�=�������T�v���w�h��\�V�ƬD4��	]���p��� <�A����|����-�J/X�V���ޒ�`(�$Y���G		��j���!�9Dއ���~7⎀��1!Z��EoK�_�;��x�����R��E����ל��d�p��h�����A^=4���dc2�FNi�'\��"��8�61�&��%A!}5�5 ;����[n!P������_����T��z�(4ɢ��	Qs�Z�:�'�/=�"1^����W�?$�7��: �{/�Cd #$�j� T��[��_%�ڊ�6���L�6A4�)䷥���t���ou��p�v9�����l�UG��f���˙n�-_p3��m�Odi�5 ��h��nP� b��H����,��L��Ǹ�tpԝ8L�J����>aә�%;��/����e��F���q2���ˆI�s�/~����݉$�i$�%#W�t��91_^2��Cp]��TH�d�n�J�6��gZ�}K@�0��0�+���� ��X�P����.Q+>�W�\�_|{܉�`5���X�s�ƲJ��������wb�n)��3,��c�zBpE���O�h��7W4�'�Z�yeZ�hBҠ�s��[��U�ԧ{~�7�7dc��"���]�2�b���X�:<M<��-��ߚ1�Z�(�e����q8�*�&���.�%s
T�B�O0_�肉��^�Դ�ZT[�*��ML���+*�6���T�0'�S$8v�O�O��I�����������p^&�mL삷Y��zi�MK�1|t���WhoݪfpR�֩�"�A�����f���[�}w�s��4��#�C1�^����7؅��?u��v
c9'�D�.�I�؁`���:�5��|�滠�<���Z�/c�z߁R�~,��ގ*�Jg��	�����d:�#��X�,qLwy��D/�S����]��F�+Sxfм�F��Q] �p��/����R�6��	7:M�p�4D��<�]�T8�!�ӕo�n������"���Q}�!����7�OU���&���{)iRM7�|E��t"��#�k���q*h$�$/R�R���"MN{ڌ�	ꜻ��w� ��j�n�'�hR�𡙼�g�`�a���m�����9��PY3{P�%�ȸ�R���Ɇ~hNh���Z���{0��Yy�?	�鸽|��/��P�L�V0Rj<m�1P=�%��o�!"c���,'+���n0�;�8���q��ׅ{�2����m�@T����T�6|��X/�v�����������u5����7W��p)���o���1�"��&L��{��ˢu�w����d��K/�8>��;��oXB��	n,Teh.&�@>�<ur�h��Ї�r��v>WmY��,S6���B"D��5���2�S���$ܨ��3ɢ�� 6õ�G'V2���HǠ�U�T�+���	�0�8�����PˇmHg_�\�mA��' ��!=���|�MH��R����3��^g׷���A{y�-���Z�u00&�z�WF�(w�?�kaO�ْK#����r��b]-qVғ�P�&�����*�ѻ�,dL����8$�"��a���&���]�fV��*�?%�%B���ͬ�S,���@e�[� �B#�FR���'�������a"���߀����3��Y:j���8�!�R�i\,$';B*@}�!��̔�y� .F#5�/���%?J��j|I
�EC�;�����'�"	�f���S�r_�F��������a�Md���8�.g�n�\��Q�^Zyp����PtCrڋ���6�� m�HQ������g"p/bl��j�s�
D���9B-�*c��g��R�g�.�]�?q�W���(���ư���څ5F�ܥ�gm�Ҹ���=��̺��٥$��Q��e�9�	ys*�N�Zޚ���A��l����Lu����'�M���.bl��+ĸJ�Y`k#��(4c��,��J�mZl�0�P�%���K�6k�yP��_#]�23BE����|n���"��'x��y�	�z��W'7T��	�q۶�S��^��0��ӗ[.�S1�y��'3��XԐ�bt�^9�*�8ؚ�����.�ۧ#!�y���К�S�+`��݈(��~
wF�
Y�H�݇w�U��#�rU�9�, x�S�����B���>�MM�.�y��N��dD9��o�J���r?k���s���tip�+	���F����x�,�A���]kg1)�%gQ�*XP`{��v@N���]H����Ũ���4��rNLp�δ�F��,R����`�v@����ob��CeBc�6�$�~��K�n=�Y�.�DEӾE�ēk����5�*f� ��C#:����e/�������{�h����w�'����}u�dA�R.p��I�@��$��I���.���:,�h�U������97� $�'�l����w"<��"�+�탿y%��Bl�<��0��3� ?�1�t���y(���?	���V8��h�.�Q�]!��4�D5�kZh$�
��H�pF�\x���ۜ�_怶2ݞ��h�
�[�ow����{�7���|�(�����F��g��	��X�?��V�lɳi�՜�}�=�8w��/MT"+~n���<F��Ĉ�oA���(�9Ș�%'��{=2cJ�W�9��O����8�N:���@����Mµ�Z��6?��!�4��,�&�-)�#1��I�o���:��_��{�ɬ�Ү˔(|OΩ�A�|�
T؞V�����h,ߢ��d�B�ȯ>�/D��j-<��QUX��4@-��j��V��q&55,Ͷ9iULQ�|��%�`��]Q)�	�z�#��x�1궍��+E��8��ue�V�>�mq�k[�&l�����lus�Z�_�\��藺gJ�]_�� !d|
￲�ÿ��HG�����9�f]��aƼ+��h����z�F�
ՍfH�c���F)M.=��tȇB+xV8���T�D��N��k�6��j5A8N�u]�[��>�Fk-m�MϷ'Ƭ��Xc�Ё�2Փ�N$�!u�4��R�eR�A�HN���A�x�H�0G���\�c���+4��e1��W�����w�.
cf �O�?]�s��+�<�9ʭ+k�Ј�;����h�B��戍vՇB�<��ƽg>��#�߼����t
�h��k�����1	�E�Ck]%J+�XkX=]BE��5�WN-0ˇ3$�|=��J�X��6ۃ�\̯�|	�h�lčs�Ϊ<���%���2
�b�T�afRE��M�%DG�sNe��O5�>��Fd�ނ��{<o(�|-��T�z�\��kg����.]ň�+Cw0���m��Z�wA,v�K�%Y��Ј��Fm��p��vgvI��#�L�w	�e��Q�g-m?Uj7gy���i��%�G����$�$�d�Q%����
ͣ���]��'!%0V~yw/~�U-���A�m�Hm/ca �"o����K�KOحB/!s���v��C�������2�~=[&�G���AS�
:C�ø7��k�o�Д������{�$��Lڏ��Wc�p�ɜ����)�����9h:����ץ+H����m�|�fQ(�%��������g!��/����]Q�)b��R&�ج����e���0o?�X6K4���x�����w��q9 jc��]�(��n�4���䯀d������f&^9��g�̜mB|4��<�L �}{�H�����7}�L�ظJ�Ts�^���'����'q('D��BX\E�_a7�ZS�`��t��?�� ���D�}X�A���X��<9&汜.��d���^�����GBW����[�4�i�!s�IЪ�@�}n(��J�0�'�ٹ̒�Cz���k��z�w��ʯB4��O��RP Jކhm�Q6��l9�&lD&�>�چaS7��I�PHA����'a�q�Z��C\#7Q�< ���2�[�`����O��{R���5���h�Vh�AO�@�]�e�9��Y-��?X�,���4���V��M��Yd.�=��@ ĕ���H�z��Tn�̕�hG� �
�	O�2�J��yM6
.=d�/��X�j95�XF
�]$���Md�2�n�Y][� �B��C �=(K������]�1�zd�~	>�*t�h�3H+��hv!�ma}= ���P:��pw/m�1b6["��鯤@����k��,����M�:�H��Ʊ;p�b�n��_��Ta!%IO���?w41.�<�6A>ѥ�J-Lw�I�L�)�v8/�3P3T�4H_n�9�"�\��X���]�BXb0������Ra�y�X��Ɛ\Dh�"����TP��S�A�L�X���}�'a�E�º��f4�y�e�X�m�$�ʷw����$�T#d�c��Y�.9_K+B�#�b��:��(΄鸲=�����X�rr�%�$E{��Uoi4�=lk��vi��ő}�;�3�?����ϗ��a����ek8�7�+Im���3�$s�l��ԑM���r�iW<���k���z�MAd�{�����9A慍�^-��~��S�`�qDM����o��c�
d
B]�07�#ޒ����D�B��2�ǐq�	����H��|�dx/j$�3�&R���qep��k�c�?Bn�D�]媻г�/~��MP�\����O�aI��r�CT��:(���)r���7-4�I	�e*�����ثBJ؜�A�Zu�G�u��&i���7�	�Q�f���nS���#T8,zi7;~n��)�G	&X\�4���}��rm�i�����#%��_M/����
lO��پ�kW�{c���.��S�t��u�k'�j�7��#Z�SW��O�F�2<h�@c���j��*[�=(��'�vW��yR��tf<jvF������-U��/!�֞敃@�ǷN�^�5Tߕ��ءP��!3�����NG��N��\$^V�&���)]�I�V���]+� W����_*O�y�LV
��n�"dms��kj�#Ƽ��#(�BLI����EjQv�����!Mu����<~K��mԓu_�H��wke����8���3Tv'_��N$��Ri�;a���iٝN�R�YB.��6��u1~��uz�h�>a�֌,�(�Q}�3x��oQk����6N�W���t"caL� M�r��t��,�7��'+ˮ�WF���C�;뉧Vx���?v��
؋���&���;Oj��j�)�����~��1����yBd0�e<�yR^i��Ӣ�nH�4��\)F,D�r� ω?��;b��>`���>-_&�C1][YгSe8���._b�Dp���7�@�������Pf8E����(ѦgK�B4s�.
��]�0��Z�"c��^�&B������5ik�Ƿ7<�� ����7L���CG��'r+fB1�����������a�)�� �e3^P�4[)���-˥a���b$߾�;Eb��I#ɷ���m=veA�&-�P1#�"�:�����ŏ�Z7ո�etD�T��iT��t��.��N�a4��څ^�s����R7�b��|�XTFQ|[�ڿƏ�K�NN��KG��ںVZ,��.;p�0t��:ȥ�4˿"o�6����"|��0 �����[Q��.�eY�M���AI
^��8Ӈ8�r\�$)Ck=�҃�����F	�\���O�qt��gZ�Eֶ90��8>r�4��ѭ��~3P�L*��l��L��d��٠��f��E~�����xO�>��n�ߜ�#�~')Wݱ��n�dq�>�՟#�|J���9���DDx`�R5���	������:���k��	�����煮 �ڐA|A�Ă�Kf��e��o�%�e����*ɓ�.!�T�v�5%5]zt����a��흃�0���ڻy{ώt������b�.x��햹)�.O�;��L+ܶ#�Y���]���=YI����Z��h�l�� �Y6븆��n����������,����˨jw1vWƆ�b��M�4��YpNv����@U���?����]#N��g\82z�h/t���Қ�����v�Fw�C��ΐ��>�e��,A�b?�)K��y$S�k)��"��K���7���ȸ��^8m�V�]��Bl	�ry�&n�9F�ވ#������)15�w,�����dD] ���bF.�bʹ
��Wͷa�����h���{A� ^O��5��v��5����1{�˸#=����"�oO�@�� ��ch�d������W9��5����&�<{���B��﬍{�l�b1kj��� C^��-w@TݐB�@u*�J�A�c�P]�D�SB�x��g�D�w<'F�[�`�!`c�,fk�6��z�ʛ�v5�#)y+<�s�'g�m\cሩ,�=��*p�x�#��>�kF���d�o6[�]�g�����AW���v�6w:��F�Z�ʌzMe��&���2�$c��E�b�i���;n�Z�{�ɑ�b��#t��DѴ���?߯�XB�#���	�3�R��]��PJ��1e<���y6��I�H�]��f�
��_.��Ɗ�򲗂nD�  ��X�7�:ׯ�I�X9��V,d;_��q�lg�9���~!�]�l���p���@͊�{��J9C�u������b��ȣ�w�R�7D��q�?T�����5):��U�7����& Σ3Vk.&�);�ؔ��2	�7]6[�U�a*�ȥV��1���_1��x��#�?/�(:eMU!64m�<�}{ֵ@jC��F|(� ��ȸ+.i4�/`�T���$��.�AS 8�Iz�u7i���l�,W�=�F����h�`�8�U��煑d����.l�3em|���s�2e���l1�K��m��x.�gEW7�_���،A���)��v腱���+�����Hi	s;��Jת�,9R���K�I�X�@4{��#f"���}�%���Q�U��?�5���A�,v?w�2$�i=��h�����+��@�A��˔"P�a6�:���Mo�.���f�6�-�-$r�
�s�D#w�ʯv���m8Ks���: �̡��5v�� 4|��倠��r�)".5���!��H^2�t��qF���'`�,��k���n���/6�+>&L��E�N�6Q`��C M[���3s�JŬ˟#]��B�ڷ��ƔÛ���F�`$&d�wD�)�I��ȋN7�;YϿJ�#L��^ȴ8puԈ(�?�/))ڍ�A������Vt%�����ʞR��L�e>۞H�V����A&�2NfT ��D�sa�$�,��7�ܴO0�w�-�#`\��~�B����R�w�C]���w�Gs���f8z�h>�̇�R�f���g�?�����R����*�!q�:.U	��BR$�պ��ď���`>P��c�M��t�\:�,s�?��7<0���
����Ck���IZYQ�xBu�q]�2�0q��E�bo^	hH%��x�F�R�k\Z|�m���T.����7ߘE�P��1����E��|�:���S���%Af��fmpo����������Lk�|s�="vބ�w�P���6��[�vl����A��>�$6!�ufB�=�d��5n8����0�'���X�ZO��6jg�NĭR����[�Y�Jn�Ѣ��:�����0Qu�� w}�[�����	��j1T����I6��dM��Yң�*��r���G��ʂ',�r��a�@'�ea����̞��!��g�{��H�	��}b�ݠ�b8��H(,R8���̈ߨ�I�c
\��{Fat����A���7li0���2ق���[�7l���k��!T�2��+��CU�����tHEg�¬;�=�d>"	Ŭb�؜��2m{����ju3�ھK��v������،�%V��G�SMӬ�؊1��l+�ۏ�hti93�#� C���ܙX)ֳtK�恗}7�`��Y�@��e��[>�V � oh���L_=3�e�F���
�� �\�a@�L������ܬ�f��?�X�P�*�
��^�zm@���.��8s��5ęS�Z�V���^Q�.	�w�Ι4�l;s��RYbW+��jW�`Ji���T"�j ���j��V�qOU
O�����G�=�=.qc+ĸ��'/RA"�g7R�Oz�����s��vM?�3#�O۪�o�☯Wm`�n���N�8�Y(4�3g��Ϲ@5د��N(0���ĠoБd_l$���Tl�P)N��7���UQ`�	_�)t��ǜ
 	��G���St9�Q�<�"�+��󦎮P��X�&qj�#�_���ڕs��Ɯ� ��N�ǝ��ۄGm�qQs�Mb�0'p��������P�F�x[$��Y�\Ә��j�>�]�����D��Q{]K�� η#��n�Ld���|0���|	΍-9U'�C$`�w�<�$�v��b��N�f6��7�{�F�e=�\4��Ƙ��)��U4����Q��(�3��H�'�_��������L���wv�Gd���.r+C���~��'-*6�Ȓk��9(�1D�.c,;`㏔g��m�
��*�J��]�ugW����'���s��ے�Q_�ڙ���۩�h�R��q�����7�sM�[b^�O�$����?��I�i�,��n���P{�G��1�u��9��|���V҅�3 �Q���<�(fVF=�my���[�n�Y�S�A����cF�-��3o���v�W�����[�FE���)��\��������?ߤuW�~���~�L�?�{ٔ�Yl�M�a��۷H'�&�W�@�1EQ����lr�O�y~��_ �;S�?��A\n�7����,cI��������>c������1G ���I�Z��ܢ?�N��nV��`	`v���]x���V���(���gU&�tt�4�n2��a������q��B泾s쨲�f]�f\G6SIo�f���F�\�@���w�ڱ�lY-���p$Q:��V����N��2#���-K�7�;Q�+�#hW��-��[��+����'�N
���<#,�<q�^A)���'-9�A�zn�8���3�����ZKG�M	V[?�}�B���5�/qgo�㬬,�4̏i��]�,�f��M��ʈEA��o^H���0��ʼ�������:�,�~f��ysU�oC��W�(���Y��C㷤A�WZ{q��!�_��,Ų~f|��"�r�ѬU(L�y�ݦkB��RKr٢����#m���ޭ����ώ��������n��lUK���	6 �p�)��֫eE
q�=��h*�:�C�?óB+�=9}�&�x�e�qj7z1�U�|H��#�	�0����c�>�jm�\�>,����P#�>\�G\������E�}��̵̫��)�CW^�1�~-N�2��E&�d3;�������X�c#�9ޫr�Dq$L
�%�{d\ˈ�1|c��	
DK��/��]�sr��8�^��{(�w͗���N�(x8�~,kzH��.�֠g!��Ec�S����5�y���59ߋ7'��Z��������H,ߡߪX'7Ӽ����aQ�`��FGޣ�YD�^'���VV�)e V�C+��5���I�r�{��N���!Wa��?����v���J��~�c�t�|�3��hA&�kvc�����+��3�-����k7ݪ��:X`x�X���O�$�5�<���Ϻ!W�k���5�ۡ�Le��#{���e�W��Z��ϻ�wmM�kĞK����y˻'=�7z��fd���[��hm��G����ݔ:5�0�z�(��/d��hT!Ϫ� ԅ�x6�(wB�xr�{������(�P��#�̎����sI{��oS�������nΖ,&*���WP�|�E�Y���6X��R�U�C������bpOn�eB��6��^�{L�xIH9��A������g�%SY�2/�%jjP馒��z!��q�����FX�)���s,,��c6[1'=0���tigN3b��G�l��D4�C�8wp��%�aH7	U�Q��zL$�r���VG`��I]d�H����P�U�Xr%R�Ԡ��We,PxSX�?�'��~����y�u�d��6�9�Yh��ٶ&��xQ�0��HPYեM����Q���Ѝ�u���􀜬+q��L�/^d
fO�1��'4d�5�Ŗ�l�����b�+t9J�o�kVI/������HL.����?(0$tqA���I#���LF�5}'�k�~u�K�/9�e�LU?G��sk�i�j_] ��x�AW�O��H�<{��D>�n�J��`2|63���2������\$T�� �7Ú�W��t�埲�Nw���s�o�uj;%@.R�Ѹ����/;4��y�ϯ΀'�x�9�����!��s*<��|��́BB�[���h*��@/����ٞ��C�3�'��b���0�8�5��в)ݎ��Q	M���Kl�Bj���e��l7'����Ya%S�b�SE�h=�G�&[�m�~�1��ӂwLjW#���>�ҾHb�cQ��߳8����s�<�L�.��ho`J���ޗI�����(��ȿ	/������L*.�թ*95�	�����H�HH8�l�a�â<���> mN��0
���3�*N��o��^��a��S�����O�b���:R`
_�3�t�� �� �!J��&6h��n�5'�c�#E��Vd|tK�u������-��Z��Ǖ�#k�C_;EV?�/��5>$�|�+��c��MLQV�Yx�Α"���-?� ��9^�P˃8� ��_-{|+h+�f��Y���pjw�s�An�+�G�nabhĈX��E��P_������� z�$�de�N)#���)n�l���8寠얐ہ�����=}�3f�ɿ�Z*��nw��h��뀄���Y�;�_rL��,�e�����?+��`R�h���4^��wƜ��4�qn
��s�9�06"��~�P�~}��$�߷���	y1�+^�U뎴m^����n�,�qBn��Ƙ������*N�Z+��l��E��2vT^��ӄ�����2�a=1�s�F��ƨBv8Fph԰�C���z���\�����`G�n�jp 1��h��j�Ь�5,'��>y��}�k�~��ɝ��a�O�~��T-�Y;̣����*X{2�d�i~���Cq\��MʃQ�B�]�ƎV;�B�s�r��T�]xj ��t�(#ʔYF�C�\t*Ƿ*q^R\��0�aT�(AT�?z�����/Eܼ`�	����M�#�I��R�i�b&^C�F�v���k��.$��rI�;�����W'�ɍ\����G��U}�8J�KN�6���]d�����02X쇾��Je?���*o��;֪�)C9 ��4�7\"
k/J&?ub��i�������eMV�w9UCLmL#�SF��*S����x�Ϭ�U@����Jgɹ$W��y����cO�����M��u��6t�$�{��1��Z�kR�6727���e��GV�B���0�N���)��}� �Z��h�PK,!Q2���p�� �Σ�@�S)-��e�R|[��O�O3�t|��A�%ϔ[��i�x��s����Noh�[Y�̶���0tU����\b�%_Ƅ�({�Y/�䂀�u朚�}e��Z�#g$|>L��+�UR��P��àϱ̞�C�������w���2����迆%���b����E��w���
�QE�\`�
[A.i���s�~D"��=���]5#�*��I��b��o7�+�� ����\Urc"g��^�}��ol*�fP��1��[��?���BJĠ|�Z�ܿJ��h�bы��u�mG�����ء«s��?�ތ�Ο�/m��2d�I�O%-L%I�o���j��Q�?\��;V����l����N�u�n���#hն%��%�k;�o�P��q)�?[>i7��$A��~EU5t��g���rB�Y(�ex�鏾ᰇ�{�z.k�����X友gT6�^�ۦ�U0�_G��"z��CX�~��v((�_FQ�3e�T��_؜ʧ����b� ~v~[SpI�2�B�On��S�q^E3�ai�
ڒ��z��={��HC�@x�����O�G��)Xح�|���):�AF1���;�X�s�j�:7���w����B#Bb`��~5͘M$��`y�_������Ч�-$H�d�78峃�]=)�{��Iw�*�C�a�N����`����AB�
���Rt��[1/�D�X�t��i���`�>�[�a���	V��ԛ0��w��W��M�y����q�>�5@W��`�B��W��I�L�d������1�q>�Y|�^vK݉��Łҍ���a�l�
mM��ضRk��k�A�#���
�q�0�4ߑg�d���a�� o���J��s��o���G��vR6|}�^�i��<BS�Q>��T�c�z�8��0c�.�݀��u��IH�[�V@�u�q���2�����y<��5��,�#�"{(�V��Do��������hg�q�6Ш˄L����y&II.�Yc.!`��sR�֍D�N>���.0ז7���9]�M���l�2�"��q�ș۰��ؽc�?[׎H��_���"��7kg];�y@��́�d
�}{M�?�G���=v�t �*_�m��5����c���z���#��l#��m"���Ru1Օ��#/�Ԍ�\��:[�#���q�n�Q�����T�lδ��½��FE�#g��R��/��e���E��ns$��H�.۞��&CG\)����[�M���w�C�;t�{��Z�4�Ǿ�qWmF�M�R}��j�8^{Q��:����(8`>���F�zSn����B ���'��vNk"^i�	�>��ljc�>]��3��\�3����?��>!��PHy���yf��\����q��3K�B�O�v8��BԦ`���я��O;���a���r��9(�xP�̏���.L�������	8�6�Q�|��{(jG�wN��7ȇpq/a���W|���f;����}�b�+�)��
��X�֤#�%��ش϶�x��dK�@��ͤ�(k6�F��ڃ�F��G�և
����w�G�5u�s�h��W	o��]� d��H��{�jpVl5�Xx��,�yi���a�t���Y���.�7���;�,!����n��xA.�"hqc6��Xw_a��
�~�ך�GP�]4�4�?�=x��F���}HK�fA���au.��Am]���ZC��E��VY�6��WUrh4=���F��wJH:�j�+�M'�BúrC���u��=���(�*%�/��f��g����µ�̤�4x���Ўd���k$6cY��7f~�����T@~ݦ�<�|%��v�q�`�䴶��	<�d����Z�V�~� �F�]���M�}�"��!T�Gh�O�=��7ɧ����N�{4aM)���d�v��x�R�n�Q��WS�cڅo�p��� ���,����mQ�P�3gu�QO�ݵZ��~ ��	�"DR*��tP��> ױ�;G'�\M7tw��Ju���
��w�G�" �E1&�	��C��W�K��=Qb��!!�j��$̂l�4h�m;M�6�r4׳�wiƄ	�^Ԯw�<C������#\A�Gk��/�޾�H��aO���&I���f�峔O�(�2pJ�rYn�v��ѯ���s!������S#�_{�Gp�7�Ôb���� (�r��%}���K-�Q�ߓ�r�7a�����XL���2��DV��^��[8�.����R94�~��܈@�6�;v�Im�3ϳ��nI��!��5����a~VA���,sc���شp7�ⲮLS�$��O�P*zg�S �*XQ�3�l��6�5ݩ�5*�i*��y���Y�����ʌ�E�1�i*j��;#M�ݾi��:\��0�QE):�������$����og'�����<o�W�:H����]X$t�A�|� !w�}Q!�ue�|�bM�6������f�!,�:L������y(�'�_Qeb��:c��>M��|%���T���K{gaw]�!;Rjqz����dm"
 >�Na��E�#��Z�w .0�����0��70�*��������2R�R��Ds\��&��n��\�Þ9k�JY���7p?C���i��i�����^r$����=�� ��NW����q��ܛl�՝����3x�|�ر�y�2m�Y��rh��&c�#�3Nd=���4z�:)0��T������KЛi�J|b��aj��,��3toИ]qk`�pY��߂�e�������o�u�Ip�"�=lf`1�PX�p2�c;�a|<2�5ہ#s�G��U���.$�b�Ϫ:%̹�g�y�l��}�tm����D꽺R�n?�D����/i�4��|nd��z�UB5tI�
ǫRv>�x�I�℡>|6��-�tkJd��Jq_SD����p>۔��Xk���j�d2�_c}����^$�-�=2sZ�K��UF�R�:�.c6��ٮzZ���0�s�Km���)�T� U:�=���X>75��}���
	󭬶!Nj��D���pbl�/��s��R�!�,M��*j�Ku�}:#ȥy��pX�d�a�n@�n��$b,�Bn.qz�ŭ�I�q�MwE2X�11T�H~�޸����9Xp����7XS�֦��PdN�ƐK:��i�	Ah�M�76{1|�^�b��9�*�㞺;j������fj��TM|�u��ޏ�I n��Q�J���S~H�^�ѣV�v���R;]�'��kS1�_���1�[��~�̋���X7.�b�	��~e!��i��NO�O7B��V~��{R�{��/��]�nT��cA�K���+�����(0�B�>^w��8.�]n����l���/�rK5�8�aR���Ȗ�qu�5�;6\�\ָj6�������金��.8��`k�և �d>�-�뺌e�G�j|�o
�S�4�B7���L�ka}D�����r4�Ug�F�)HR���O�(�t���gY�!�U�RՈM��a��`����s[&=��k�Sx�����������z���1��K��T����tsf��
��:\���p�H;���9��� V�����yM�_�O��s ���}���S礽s;iJwڃ��]��%T���4[X�w�):���Y�|f�/`�@~<f��6��DRf�����~D�Fv��#e^D֥�O/���@/�>W��@�Ap2ߚ8�M%QFa9�e�	y.�୧�'��)+w<aؕa#�a�oޯ������-���鈈JJb(>Gu�*�@'�@��^R�����
B،�aC�V������̥^�Q	Đ]���1�W��W-b���c0]��%��2ȭ��S�����#��8�=�r�a�'UeJ�̹�j/�e�l���#9W7�A
��?㣰��v�c�$�H�E�Xe���v�,���s�bx/&/lJ�Î+Cn�	Bٳ��@ }��v�&�ʅ�BQ���9I������@)4t7�&U��Ɍ~p;�9V$i	�|����S1����?o�g�)��wz@���ܽnB�@��<j�^�X�?��B�S�ܬR OmX{y�h�	�zX����,$1v�C�2��uJC���!g�	J�߾�]�$x�!}��W���;��@�V@���N����+��b̎����0��j�Ȗ��	�j��R)���#c��v`�uٍ�KdI�$tZ�+����L?@P��C��T5�X�'�n�^:ZU<X�n��.���w�V�,e���X���R�-Y��G	a�-#���9��� ?I���C��
�Q����F�0�~U�%3�g_��(����P;��t];{n������W�se�]��"�`���XE���_*̻ao ��m�.�g;���0�:�$Ѝ@t_�F.�.�W���I�GP2�(`mU�H�W#��t��`&e��ugg��尟9��Y ��c ���:Ԏ�c���*�餪f��u��������]i&x3¹���!Q�Ѝj5]	��
��V�����9���A�D4H�� �e�9��a��RI�UX�M:�ǉ0�<�p��Ԅ�Cγv�Z���e���cb�R�7��.l�^	Y���%�5�LK�:	I�������\�Xnn��v��?��	_pI���p�]8'A)U����m���be�~1yebk3F@t��cV:�ė��]�_�|�p�����4���7��'Z����U������R��:%>����f��m���k8��:V��!0����|�k9�|x��>����m�R�&J)���xO�0)�fx0:U� g!,ߙ���,�70(�F�x�/5+,!���v�A?�Pf� ��3�K���#y��H#�?֠��8UPX`@� �^��+����˞�_59iAgYXNzZXJ0Lm9rID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykuaXMub2s7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAubm90T2sob2JqZWN0LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgb2JqZWN0YCBpcyBmYWxzeS5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RPaygnZXZlcnl0aGluZycsICd0aGlzIHdpbGwgZmFpbCcpO1xuICAgKiAgICAgYXNzZXJ0Lm5vdE9rKGZhbHNlLCAndGhpcyB3aWxsIHBhc3MnKTtcbiAgICpcbiAgICogQG5hbWUgbm90T2tcbiAgICogQHBhcmFtIHtNaXhlZH0gb2JqZWN0IHRvIHRlc3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdE9rID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykuaXMubm90Lm9rO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyBub24tc3RyaWN0IGVxdWFsaXR5IChgPT1gKSBvZiBgYWN0dWFsYCBhbmQgYGV4cGVjdGVkYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5lcXVhbCgzLCAnMycsICc9PSBjb2VyY2VzIHZhbHVlcyB0byBzdHJpbmdzJyk7XG4gICAqXG4gICAqIEBuYW1lIGVxdWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZXF1YWwgPSBmdW5jdGlvbiAoYWN0LCBleHAsIG1zZykge1xuICAgIHZhciB0ZXN0ID0gbmV3IEFzc2VydGlvbihhY3QsIG1zZywgYXNzZXJ0LmVxdWFsKTtcblxuICAgIHRlc3QuYXNzZXJ0KFxuICAgICAgICBleHAgPT0gZmxhZyh0ZXN0LCAnb2JqZWN0JylcbiAgICAgICwgJ2V4cGVjdGVkICN7dGhpc30gdG8gZXF1YWwgI3tleHB9J1xuICAgICAgLCAnZXhwZWN0ZWQgI3t0aGlzfSB0byBub3QgZXF1YWwgI3thY3R9J1xuICAgICAgLCBleHBcbiAgICAgICwgYWN0XG4gICAgKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgbm9uLXN0cmljdCBpbmVxdWFsaXR5IChgIT1gKSBvZiBgYWN0dWFsYCBhbmQgYGV4cGVjdGVkYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RFcXVhbCgzLCA0LCAndGhlc2UgbnVtYmVycyBhcmUgbm90IGVxdWFsJyk7XG4gICAqXG4gICAqIEBuYW1lIG5vdEVxdWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubm90RXF1YWwgPSBmdW5jdGlvbiAoYWN0LCBleHAsIG1zZykge1xuICAgIHZhciB0ZXN0ID0gbmV3IEFzc2VydGlvbihhY3QsIG1zZywgYXNzZXJ0Lm5vdEVxdWFsKTtcblxuICAgIHRlc3QuYXNzZXJ0KFxuICAgICAgICBleHAgIT0gZmxhZyh0ZXN0LCAnb2JqZWN0JylcbiAgICAgICwgJ2V4cGVjdGVkICN7dGhpc30gdG8gbm90IGVxdWFsICN7ZXhwfSdcbiAgICAgICwgJ2V4cGVjdGVkICN7dGhpc30gdG8gZXF1YWwgI3thY3R9J1xuICAgICAgLCBleHBcbiAgICAgICwgYWN0XG4gICAgKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5zdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgc3RyaWN0IGVxdWFsaXR5IChgPT09YCkgb2YgYGFjdHVhbGAgYW5kIGBleHBlY3RlZGAuXG4gICAqXG4gICAqICAgICBhc3NlcnQuc3RyaWN0RXF1YWwodHJ1ZSwgdHJ1ZSwgJ3RoZXNlIGJvb2xlYW5zIGFyZSBzdHJpY3RseSBlcXVhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBzdHJpY3RFcXVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBhY3R1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gZXhwZWN0ZWRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LnN0cmljdEVxdWFsID0gZnVuY3Rpb24gKGFjdCwgZXhwLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGFjdCwgbXNnKS50by5lcXVhbChleHApO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdFN0cmljdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyBzdHJpY3QgaW5lcXVhbGl0eSAoYCE9PWApIG9mIGBhY3R1YWxgIGFuZCBgZXhwZWN0ZWRgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0Lm5vdFN0cmljdEVxdWFsKDMsICczJywgJ25vIGNvZXJjaW9uIGZvciBzdHJpY3QgZXF1YWxpdHknKTtcbiAgICpcbiAgICogQG5hbWUgbm90U3RyaWN0RXF1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gYWN0dWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGV4cGVjdGVkXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5ub3RTdHJpY3RFcXVhbCA9IGZ1bmN0aW9uIChhY3QsIGV4cCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihhY3QsIG1zZykudG8ubm90LmVxdWFsKGV4cCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBhY3R1YWxgIGlzIGRlZXBseSBlcXVhbCB0byBgZXhwZWN0ZWRgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmRlZXBFcXVhbCh7IHRlYTogJ2dyZWVuJyB9LCB7IHRlYTogJ2dyZWVuJyB9KTtcbiAgICpcbiAgICogQG5hbWUgZGVlcEVxdWFsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZGVlcEVxdWFsID0gZnVuY3Rpb24gKGFjdCwgZXhwLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGFjdCwgbXNnKS50by5lcWwoZXhwKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3REZWVwRXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnQgdGhhdCBgYWN0dWFsYCBpcyBub3QgZGVlcGx5IGVxdWFsIHRvIGBleHBlY3RlZGAuXG4gICAqXG4gICAqICAgICBhc3NlcnQubm90RGVlcEVxdWFsKHsgdGVhOiAnZ3JlZW4nIH0sIHsgdGVhOiAnamFzbWluZScgfSk7XG4gICAqXG4gICAqIEBuYW1lIG5vdERlZXBFcXVhbFxuICAgKiBAcGFyYW0ge01peGVkfSBhY3R1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gZXhwZWN0ZWRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdERlZXBFcXVhbCA9IGZ1bmN0aW9uIChhY3QsIGV4cCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihhY3QsIG1zZykudG8ubm90LmVxbChleHApO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzVHJ1ZSh2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyB0cnVlLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYVNlcnZlZCA9IHRydWU7XG4gICAqICAgICBhc3NlcnQuaXNUcnVlKHRlYVNlcnZlZCwgJ3RoZSB0ZWEgaGFzIGJlZW4gc2VydmVkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzVHJ1ZVxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNBYm92ZSA9IGZ1bmN0aW9uICh2YWwsIGFidiwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYWJvdmUoYWJ2KTtcbiAgfTtcblxuICAgLyoqXG4gICAqICMjIyAuaXNBYm92ZSh2YWx1ZVRvQ2hlY2ssIHZhbHVlVG9CZUFib3ZlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgYHZhbHVlVG9DaGVja2AgaXMgc3RyaWN0bHkgZ3JlYXRlciB0aGFuICg+KSBgdmFsdWVUb0JlQWJvdmVgXG4gICAqXG4gICAqICAgICBhc3NlcnQuaXNBYm92ZSg1LCAyLCAnNSBpcyBzdHJpY3RseSBncmVhdGVyIHRoYW4gMicpO1xuICAgKlxuICAgKiBAbmFtZSBpc0Fib3ZlXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlVG9DaGVja1xuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVRvQmVBYm92ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNCZWxvdyA9IGZ1bmN0aW9uICh2YWwsIGJsdywgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYmVsb3coYmx3KTtcbiAgfTtcblxuICAgLyoqXG4gICAqICMjIyAuaXNCZWxvdyh2YWx1ZVRvQ2hlY2ssIHZhbHVlVG9CZUJlbG93LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgYHZhbHVlVG9DaGVja2AgaXMgc3RyaWN0bHkgbGVzcyB0aGFuICg8KSBgdmFsdWVUb0JlQmVsb3dgXG4gICAqXG4gICAqICAgICBhc3NlcnQuaXNCZWxvdygzLCA2LCAnMyBpcyBzdHJpY3RseSBsZXNzIHRoYW4gNicpO1xuICAgKlxuICAgKiBAbmFtZSBpc0JlbG93XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlVG9DaGVja1xuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVRvQmVCZWxvd1xuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNUcnVlID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykuaXNbJ3RydWUnXTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc0ZhbHNlKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIGZhbHNlLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYVNlcnZlZCA9IGZhbHNlO1xuICAgKiAgICAgYXNzZXJ0LmlzRmFsc2UodGVhU2VydmVkLCAnbm8gdGVhIHlldD8gaG1tLi4uJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzRmFsc2VcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzRmFsc2UgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS5pc1snZmFsc2UnXTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc051bGwodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgbnVsbC5cbiAgICpcbiAgICogICAgIGFzc2VydC5pc051bGwoZXJyLCAndGhlcmUgd2FzIG5vIGVycm9yJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzTnVsbFxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNOdWxsID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uZXF1YWwobnVsbCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNOb3ROdWxsKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIG5vdCBudWxsLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYSA9ICd0YXN0eSBjaGFpJztcbiAgICogICAgIGFzc2VydC5pc05vdE51bGwodGVhLCAnZ3JlYXQsIHRpbWUgZm9yIHRlYSEnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3ROdWxsXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc05vdE51bGwgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuZXF1YWwobnVsbCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNVbmRlZmluZWQodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYHVuZGVmaW5lZGAuXG4gICAqXG4gICAqICAgICB2YXIgdGVhO1xuICAgKiAgICAgYXNzZXJ0LmlzVW5kZWZpbmVkKHRlYSwgJ25vIHRlYSBkZWZpbmVkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzVW5kZWZpbmVkXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc1VuZGVmaW5lZCA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmVxdWFsKHVuZGVmaW5lZCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNEZWZpbmVkKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIG5vdCBgdW5kZWZpbmVkYC5cbiAgICpcbiAgICogICAgIHZhciB0ZWEgPSAnY3VwIG9mIGNoYWknO1xuICAgKiAgICAgYXNzZXJ0LmlzRGVmaW5lZCh0ZWEsICd0ZWEgaGFzIGJlZW4gZGVmaW5lZCcpO1xuICAgKlxuICAgKiBAbmFtZSBpc0RlZmluZWRcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzRGVmaW5lZCA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLm5vdC5lcXVhbCh1bmRlZmluZWQpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzRnVuY3Rpb24odmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYSBmdW5jdGlvbi5cbiAgICpcbiAgICogICAgIGZ1bmN0aW9uIHNlcnZlVGVhKCkgeyByZXR1cm4gJ2N1cCBvZiB0ZWEnOyB9O1xuICAgKiAgICAgYXNzZXJ0LmlzRnVuY3Rpb24oc2VydmVUZWEsICdncmVhdCwgd2UgY2FuIGhhdmUgdGVhIG5vdycpO1xuICAgKlxuICAgKiBAbmFtZSBpc0Z1bmN0aW9uXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc0Z1bmN0aW9uID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYSgnZnVuY3Rpb24nKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc05vdEZ1bmN0aW9uKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIF9ub3RfIGEgZnVuY3Rpb24uXG4gICAqXG4gICAqICAgICB2YXIgc2VydmVUZWEgPSBbICdoZWF0JywgJ3BvdXInLCAnc2lwJyBdO1xuICAgKiAgICAgYXNzZXJ0LmlzTm90RnVuY3Rpb24oc2VydmVUZWEsICdncmVhdCwgd2UgaGF2ZSBsaXN0ZWQgdGhlIHN0ZXBzJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzTm90RnVuY3Rpb25cbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzTm90RnVuY3Rpb24gPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuYmUuYSgnZnVuY3Rpb24nKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5pc09iamVjdCh2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyBhbiBvYmplY3QgKGFzIHJldmVhbGVkIGJ5XG4gICAqIGBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nYCkuXG4gICAqXG4gICAqICAgICB2YXIgc2VsZWN0aW9uID0geyBuYW1lOiAnQ2hhaScsIHNlcnZlOiAnd2l0aCBzcGljZXMnIH07XG4gICAqICAgICBhc3NlcnQuaXNPYmplY3Qoc2VsZWN0aW9uLCAndGVhIHNlbGVjdGlvbiBpcyBhbiBvYmplY3QnKTtcbiAgICpcbiAgICogQG5hbWUgaXNPYmplY3RcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzT2JqZWN0ID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYSgnb2JqZWN0Jyk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNOb3RPYmplY3QodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgX25vdF8gYW4gb2JqZWN0LlxuICAgKlxuICAgKiAgICAgdmFyIHNlbGVjdGlvbiA9ICdjaGFpJ1xuICAgKiAgICAgYXNzZXJ0LmlzTm90T2JqZWN0KHNlbGVjdGlvbiwgJ3RlYSBzZWxlY3Rpb24gaXMgbm90IGFuIG9iamVjdCcpO1xuICAgKiAgICAgYXNzZXJ0LmlzTm90T2JqZWN0KG51bGwsICdudWxsIGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3RPYmplY3RcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzTm90T2JqZWN0ID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmEoJ29iamVjdCcpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzQXJyYXkodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYW4gYXJyYXkuXG4gICAqXG4gICAqICAgICB2YXIgbWVudSA9IFsgJ2dyZWVuJywgJ2NoYWknLCAnb29sb25nJyBdO1xuICAgKiAgICAgYXNzZXJ0LmlzQXJyYXkobWVudSwgJ3doYXQga2luZCBvZiB0ZWEgZG8gd2Ugd2FudD8nKTtcbiAgICpcbiAgICogQG5hbWUgaXNBcnJheVxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNBcnJheSA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmJlLmFuKCdhcnJheScpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90QXJyYXkodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgX25vdF8gYW4gYXJyYXkuXG4gICAqXG4gICAqICAgICB2YXIgbWVudSA9ICdncmVlbnxjaGFpfG9vbG9uZyc7XG4gICAqICAgICBhc3NlcnQuaXNOb3RBcnJheShtZW51LCAnd2hhdCBraW5kIG9mIHRlYSBkbyB3ZSB3YW50PycpO1xuICAgKlxuICAgKiBAbmFtZSBpc05vdEFycmF5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc05vdEFycmF5ID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmFuKCdhcnJheScpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzU3RyaW5nKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIGEgc3RyaW5nLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYU9yZGVyID0gJ2NoYWknO1xuICAgKiAgICAgYXNzZXJ0LmlzU3RyaW5nKHRlYU9yZGVyLCAnb3JkZXIgcGxhY2VkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzU3RyaW5nXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc1N0cmluZyA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmJlLmEoJ3N0cmluZycpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90U3RyaW5nKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIF9ub3RfIGEgc3RyaW5nLlxuICAgKlxuICAgKiAgICAgdmFyIHRlYU9yZGVyID0gNDtcbiAgICogICAgIGFzc2VydC5pc05vdFN0cmluZyh0ZWFPcmRlciwgJ29yZGVyIHBsYWNlZCcpO1xuICAgKlxuICAgKiBAbmFtZSBpc05vdFN0cmluZ1xuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNOb3RTdHJpbmcgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuYmUuYSgnc3RyaW5nJyk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaXNOdW1iZXIodmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgaXMgYSBudW1iZXIuXG4gICAqXG4gICAqICAgICB2YXIgY3VwcyA9IDI7XG4gICAqICAgICBhc3NlcnQuaXNOdW1iZXIoY3VwcywgJ2hvdyBtYW55IGN1cHMnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOdW1iZXJcbiAgICogQHBhcmFtIHtOdW1iZXJ9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc051bWJlciA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmJlLmEoJ251bWJlcicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90TnVtYmVyKHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIF9ub3RfIGEgbnVtYmVyLlxuICAgKlxuICAgKiAgICAgdmFyIGN1cHMgPSAnMiBjdXBzIHBsZWFzZSc7XG4gICAqICAgICBhc3NlcnQuaXNOb3ROdW1iZXIoY3VwcywgJ2hvdyBtYW55IGN1cHMnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3ROdW1iZXJcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmlzTm90TnVtYmVyID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmEoJ251bWJlcicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzQm9vbGVhbih2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyBhIGJvb2xlYW4uXG4gICAqXG4gICAqICAgICB2YXIgdGVhUmVhZHkgPSB0cnVlXG4gICAqICAgICAgICwgdGVhU2VydmVkID0gZmFsc2U7XG4gICAqXG4gICAqICAgICBhc3NlcnQuaXNCb29sZWFuKHRlYVJlYWR5LCAnaXMgdGhlIHRlYSByZWFkeScpO1xuICAgKiAgICAgYXNzZXJ0LmlzQm9vbGVhbih0ZWFTZXJ2ZWQsICdoYXMgdGVhIGJlZW4gc2VydmVkJyk7XG4gICAqXG4gICAqIEBuYW1lIGlzQm9vbGVhblxuICAgKiBAcGFyYW0ge01peGVkfSB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaXNCb29sZWFuID0gZnVuY3Rpb24gKHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8uYmUuYSgnYm9vbGVhbicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmlzTm90Qm9vbGVhbih2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCBpcyBfbm90XyBhIGJvb2xlYW4uXG4gICAqXG4gICAqICAgICB2YXIgdGVhUmVhZHkgPSAneWVwJ1xuICAgKiAgICAgICAsIHRlYVNlcnZlZCA9ICdub3BlJztcbiAgICpcbiAgICogICAgIGFzc2VydC5pc05vdEJvb2xlYW4odGVhUmVhZHksICdpcyB0aGUgdGVhIHJlYWR5Jyk7XG4gICAqICAgICBhc3NlcnQuaXNOb3RCb29sZWFuKHRlYVNlcnZlZCwgJ2hhcyB0ZWEgYmVlbiBzZXJ2ZWQnKTtcbiAgICpcbiAgICogQG5hbWUgaXNOb3RCb29sZWFuXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pc05vdEJvb2xlYW4gPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5ub3QuYmUuYSgnYm9vbGVhbicpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLnR5cGVPZih2YWx1ZSwgbmFtZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCdzIHR5cGUgaXMgYG5hbWVgLCBhcyBkZXRlcm1pbmVkIGJ5XG4gICAqIGBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nYC5cbiAgICpcbiAgICogICAgIGFzc2VydC50eXBlT2YoeyB0ZWE6ICdjaGFpJyB9LCAnb2JqZWN0JywgJ3dlIGhhdmUgYW4gb2JqZWN0Jyk7XG4gICAqICAgICBhc3NlcnQudHlwZU9mKFsnY2hhaScsICdqYXNtaW5lJ10sICdhcnJheScsICd3ZSBoYXZlIGFuIGFycmF5Jyk7XG4gICAqICAgICBhc3NlcnQudHlwZU9mKCd0ZWEnLCAnc3RyaW5nJywgJ3dlIGhhdmUgYSBzdHJpbmcnKTtcbiAgICogICAgIGFzc2VydC50eXBlT2YoL3RlYS8sICdyZWdleHAnLCAnd2UgaGF2ZSBhIHJlZ3VsYXIgZXhwcmVzc2lvbicpO1xuICAgKiAgICAgYXNzZXJ0LnR5cGVPZihudWxsLCAnbnVsbCcsICd3ZSBoYXZlIGEgbnVsbCcpO1xuICAgKiAgICAgYXNzZXJ0LnR5cGVPZih1bmRlZmluZWQsICd1bmRlZmluZWQnLCAnd2UgaGF2ZSBhbiB1bmRlZmluZWQnKTtcbiAgICpcbiAgICogQG5hbWUgdHlwZU9mXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC50eXBlT2YgPSBmdW5jdGlvbiAodmFsLCB0eXBlLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5iZS5hKHR5cGUpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdFR5cGVPZih2YWx1ZSwgbmFtZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHZhbHVlYCdzIHR5cGUgaXMgX25vdF8gYG5hbWVgLCBhcyBkZXRlcm1pbmVkIGJ5XG4gICAqIGBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RUeXBlT2YoJ3RlYScsICdudW1iZXInLCAnc3RyaW5ncyBhcmUgbm90IG51bWJlcnMnKTtcbiAgICpcbiAgICogQG5hbWUgbm90VHlwZU9mXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlb2YgbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubm90VHlwZU9mID0gZnVuY3Rpb24gKHZhbCwgdHlwZSwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmEodHlwZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaW5zdGFuY2VPZihvYmplY3QsIGNvbnN0cnVjdG9yLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIGlzIGFuIGluc3RhbmNlIG9mIGBjb25zdHJ1Y3RvcmAuXG4gICAqXG4gICAqICAgICB2YXIgVGVhID0gZnVuY3Rpb24gKG5hbWUpIHsgdGhpcy5uYW1lID0gbmFtZTsgfVxuICAgKiAgICAgICAsIGNoYWkgPSBuZXcgVGVhKCdjaGFpJyk7XG4gICAqXG4gICAqICAgICBhc3NlcnQuaW5zdGFuY2VPZihjaGFpLCBUZWEsICdjaGFpIGlzIGFuIGluc3RhbmNlIG9mIHRlYScpO1xuICAgKlxuICAgKiBAbmFtZSBpbnN0YW5jZU9mXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtDb25zdHJ1Y3Rvcn0gY29uc3RydWN0b3JcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lmluc3RhbmNlT2YgPSBmdW5jdGlvbiAodmFsLCB0eXBlLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHZhbCwgbXNnKS50by5iZS5pbnN0YW5jZU9mKHR5cGUpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdEluc3RhbmNlT2Yob2JqZWN0LCBjb25zdHJ1Y3RvciwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIGB2YWx1ZWAgaXMgbm90IGFuIGluc3RhbmNlIG9mIGBjb25zdHJ1Y3RvcmAuXG4gICAqXG4gICAqICAgICB2YXIgVGVhID0gZnVuY3Rpb24gKG5hbWUpIHsgdGhpcy5uYW1lID0gbmFtZTsgfVxuICAgKiAgICAgICAsIGNoYWkgPSBuZXcgU3RyaW5nKCdjaGFpJyk7XG4gICAqXG4gICAqICAgICBhc3NlcnQubm90SW5zdGFuY2VPZihjaGFpLCBUZWEsICdjaGFpIGlzIG5vdCBhbiBpbnN0YW5jZSBvZiB0ZWEnKTtcbiAgICpcbiAgICogQG5hbWUgbm90SW5zdGFuY2VPZlxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7Q29uc3RydWN0b3J9IGNvbnN0cnVjdG9yXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5ub3RJbnN0YW5jZU9mID0gZnVuY3Rpb24gKHZhbCwgdHlwZSwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmJlLmluc3RhbmNlT2YodHlwZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuaW5jbHVkZShoYXlzdGFjaywgbmVlZGxlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgaGF5c3RhY2tgIGluY2x1ZGVzIGBuZWVkbGVgLiBXb3Jrc1xuICAgKiBmb3Igc3RyaW5ncyBhbmQgYXJyYXlzLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmluY2x1ZGUoJ2Zvb2JhcicsICdiYXInLCAnZm9vYmFyIGNvbnRhaW5zIHN0cmluZyBcImJhclwiJyk7XG4gICAqICAgICBhc3NlcnQuaW5jbHVkZShbIDEsIDIsIDMgXSwgMywgJ2FycmF5IGNvbnRhaW5zIHZhbHVlJyk7XG4gICAqXG4gICAqIEBuYW1lIGluY2x1ZGVcbiAgICogQHBhcmFtIHtBcnJheXxTdHJpbmd9IGhheXN0YWNrXG4gICAqIEBwYXJhbSB7TWl4ZWR9IG5lZWRsZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuaW5jbHVkZSA9IGZ1bmN0aW9uIChleHAsIGluYywgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihleHAsIG1zZywgYXNzZXJ0LmluY2x1ZGUpLmluY2x1ZGUoaW5jKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3RJbmNsdWRlKGhheXN0YWNrLCBuZWVkbGUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBoYXlzdGFja2AgZG9lcyBub3QgaW5jbHVkZSBgbmVlZGxlYC4gV29ya3NcbiAgICogZm9yIHN0cmluZ3MgYW5kIGFycmF5cy5cbiAgICppXG4gICAqICAgICBhc3NlcnQubm90SW5jbHVkZSgnZm9vYmFyJywgJ2JheicsICdzdHJpbmcgbm90IGluY2x1ZGUgc3Vic3RyaW5nJyk7XG4gICAqICAgICBhc3NlcnQubm90SW5jbHVkZShbIDEsIDIsIDMgXSwgNCwgJ2FycmF5IG5vdCBpbmNsdWRlIGNvbnRhaW4gdmFsdWUnKTtcbiAgICpcbiAgICogQG5hbWUgbm90SW5jbHVkZVxuICAgKiBAcGFyYW0ge0FycmF5fFN0cmluZ30gaGF5c3RhY2tcbiAgICogQHBhcmFtIHtNaXhlZH0gbmVlZGxlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5ub3RJbmNsdWRlID0gZnVuY3Rpb24gKGV4cCwgaW5jLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGV4cCwgbXNnLCBhc3NlcnQubm90SW5jbHVkZSkubm90LmluY2x1ZGUoaW5jKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5tYXRjaCh2YWx1ZSwgcmVnZXhwLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgdmFsdWVgIG1hdGNoZXMgdGhlIHJlZ3VsYXIgZXhwcmVzc2lvbiBgcmVnZXhwYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5tYXRjaCgnZm9vYmFyJywgL15mb28vLCAncmVnZXhwIG1hdGNoZXMnKTtcbiAgICpcbiAgICogQG5hbWUgbWF0Y2hcbiAgICogQHBhcmFtIHtNaXhlZH0gdmFsdWVcbiAgICogQHBhcmFtIHtSZWdFeHB9IHJlZ2V4cFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubWF0Y2ggPSBmdW5jdGlvbiAoZXhwLCByZSwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihleHAsIG1zZykudG8ubWF0Y2gocmUpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLm5vdE1hdGNoKHZhbHVlLCByZWdleHAsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGB2YWx1ZWAgZG9lcyBub3QgbWF0Y2ggdGhlIHJlZ3VsYXIgZXhwcmVzc2lvbiBgcmVnZXhwYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3RNYXRjaCgnZm9vYmFyJywgL15mb28vLCAncmVnZXhwIGRvZXMgbm90IG1hdGNoJyk7XG4gICAqXG4gICAqIEBuYW1lIG5vdE1hdGNoXG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7UmVnRXhwfSByZWdleHBcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdE1hdGNoID0gZnVuY3Rpb24gKGV4cCwgcmUsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24oZXhwLCBtc2cpLnRvLm5vdC5tYXRjaChyZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAucHJvcGVydHkob2JqZWN0LCBwcm9wZXJ0eSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgcHJvcGVydHkgbmFtZWQgYnkgYHByb3BlcnR5YC5cbiAgICpcbiAgICogICAgIGFzc2VydC5wcm9wZXJ0eSh7IHRlYTogeyBncmVlbjogJ21hdGNoYScgfX0sICd0ZWEnKTtcbiAgICpcbiAgICogQG5hbWUgcHJvcGVydHlcbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHlcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LnByb3BlcnR5ID0gZnVuY3Rpb24gKG9iaiwgcHJvcCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihvYmosIG1zZykudG8uaGF2ZS5wcm9wZXJ0eShwcm9wKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5ub3RQcm9wZXJ0eShvYmplY3QsIHByb3BlcnR5LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgb2JqZWN0YCBkb2VzIF9ub3RfIGhhdmUgYSBwcm9wZXJ0eSBuYW1lZCBieSBgcHJvcGVydHlgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0Lm5vdFByb3BlcnR5KHsgdGVhOiB7IGdyZWVuOiAnbWF0Y2hhJyB9fSwgJ2NvZmZlZScpO1xuICAgKlxuICAgKiBAbmFtZSBub3RQcm9wZXJ0eVxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wZXJ0eVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubm90UHJvcGVydHkgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKG9iaiwgbXNnKS50by5ub3QuaGF2ZS5wcm9wZXJ0eShwcm9wKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5kZWVwUHJvcGVydHkob2JqZWN0LCBwcm9wZXJ0eSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgcHJvcGVydHkgbmFtZWQgYnkgYHByb3BlcnR5YCwgd2hpY2ggY2FuIGJlIGFcbiAgICogc3RyaW5nIHVzaW5nIGRvdC0gYW5kIGJyYWNrZXQtbm90YXRpb24gZm9yIGRlZXAgcmVmZXJlbmNlLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmRlZXBQcm9wZXJ0eSh7IHRlYTogeyBncmVlbjogJ21hdGNoYScgfX0sICd0ZWEuZ3JlZW4nKTtcbiAgICpcbiAgICogQG5hbWUgZGVlcFByb3BlcnR5XG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWVwUHJvcGVydHkgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKG9iaiwgbXNnKS50by5oYXZlLmRlZXAucHJvcGVydHkocHJvcCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAubm90RGVlcFByb3BlcnR5KG9iamVjdCwgcHJvcGVydHksIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBvYmplY3RgIGRvZXMgX25vdF8gaGF2ZSBhIHByb3BlcnR5IG5hbWVkIGJ5IGBwcm9wZXJ0eWAsIHdoaWNoXG4gICAqIGNhbiBiZSBhIHN0cmluZyB1c2luZyBkb3QtIGFuZCBicmFja2V0LW5vdGF0aW9uIGZvciBkZWVwIHJlZmVyZW5jZS5cbiAgICpcbiAgICogICAgIGFzc2VydC5ub3REZWVwUHJvcGVydHkoeyB0ZWE6IHsgZ3JlZW46ICdtYXRjaGEnIH19LCAndGVhLm9vbG9uZycpO1xuICAgKlxuICAgKiBAbmFtZSBub3REZWVwUHJvcGVydHlcbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHlcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0Lm5vdERlZXBQcm9wZXJ0eSA9IGZ1bmN0aW9uIChvYmosIHByb3AsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24ob2JqLCBtc2cpLnRvLm5vdC5oYXZlLmRlZXAucHJvcGVydHkocHJvcCk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAucHJvcGVydHlWYWwob2JqZWN0LCBwcm9wZXJ0eSwgdmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBvYmplY3RgIGhhcyBhIHByb3BlcnR5IG5hbWVkIGJ5IGBwcm9wZXJ0eWAgd2l0aCB2YWx1ZSBnaXZlblxuICAgKiBieSBgdmFsdWVgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LnByb3BlcnR5VmFsKHsgdGVhOiAnaXMgZ29vZCcgfSwgJ3RlYScsICdpcyBnb29kJyk7XG4gICAqXG4gICAqIEBuYW1lIHByb3BlcnR5VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5wcm9wZXJ0eVZhbCA9IGZ1bmN0aW9uIChvYmosIHByb3AsIHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihvYmosIG1zZykudG8uaGF2ZS5wcm9wZXJ0eShwcm9wLCB2YWwpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLnByb3BlcnR5Tm90VmFsKG9iamVjdCwgcHJvcGVydHksIHZhbHVlLCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgb2JqZWN0YCBoYXMgYSBwcm9wZXJ0eSBuYW1lZCBieSBgcHJvcGVydHlgLCBidXQgd2l0aCBhIHZhbHVlXG4gICAqIGRpZmZlcmVudCBmcm9tIHRoYXQgZ2l2ZW4gYnkgYHZhbHVlYC5cbiAgICpcbiAgICogICAgIGFzc2VydC5wcm9wZXJ0eU5vdFZhbCh7IHRlYTogJ2lzIGdvb2QnIH0sICd0ZWEnLCAnaXMgYmFkJyk7XG4gICAqXG4gICAqIEBuYW1lIHByb3BlcnR5Tm90VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5wcm9wZXJ0eU5vdFZhbCA9IGZ1bmN0aW9uIChvYmosIHByb3AsIHZhbCwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihvYmosIG1zZykudG8ubm90LmhhdmUucHJvcGVydHkocHJvcCwgdmFsKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5kZWVwUHJvcGVydHlWYWwob2JqZWN0LCBwcm9wZXJ0eSwgdmFsdWUsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBvYmplY3RgIGhhcyBhIHByb3BlcnR5IG5hbWVkIGJ5IGBwcm9wZXJ0eWAgd2l0aCB2YWx1ZSBnaXZlblxuICAgKiBieSBgdmFsdWVgLiBgcHJvcGVydHlgIGNhbiB1c2UgZG90LSBhbmQgYnJhY2tldC1ub3RhdGlvbiBmb3IgZGVlcFxuICAgKiByZWZlcmVuY2UuXG4gICAqXG4gICAqICAgICBhc3NlcnQuZGVlcFByb3BlcnR5VmFsKHsgdGVhOiB7IGdyZWVuOiAnbWF0Y2hhJyB9fSwgJ3RlYS5ncmVlbicsICdtYXRjaGEnKTtcbiAgICpcbiAgICogQG5hbWUgZGVlcFByb3BlcnR5VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWVwUHJvcGVydHlWYWwgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCB2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24ob2JqLCBtc2cpLnRvLmhhdmUuZGVlcC5wcm9wZXJ0eShwcm9wLCB2YWwpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLmRlZXBQcm9wZXJ0eU5vdFZhbChvYmplY3QsIHByb3BlcnR5LCB2YWx1ZSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgcHJvcGVydHkgbmFtZWQgYnkgYHByb3BlcnR5YCwgYnV0IHdpdGggYSB2YWx1ZVxuICAgKiBkaWZmZXJlbnQgZnJvbSB0aGF0IGdpdmVuIGJ5IGB2YWx1ZWAuIGBwcm9wZXJ0eWAgY2FuIHVzZSBkb3QtIGFuZFxuICAgKiBicmFja2V0LW5vdGF0aW9uIGZvciBkZWVwIHJlZmVyZW5jZS5cbiAgICpcbiAgICogICAgIGFzc2VydC5kZWVwUHJvcGVydHlOb3RWYWwoeyB0ZWE6IHsgZ3JlZW46ICdtYXRjaGEnIH19LCAndGVhLmdyZWVuJywgJ2tvbmFjaGEnKTtcbiAgICpcbiAgICogQG5hbWUgZGVlcFByb3BlcnR5Tm90VmFsXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5XG4gICAqIEBwYXJhbSB7TWl4ZWR9IHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWVwUHJvcGVydHlOb3RWYWwgPSBmdW5jdGlvbiAob2JqLCBwcm9wLCB2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24ob2JqLCBtc2cpLnRvLm5vdC5oYXZlLmRlZXAucHJvcGVydHkocHJvcCwgdmFsKTtcbiAgfTtcblxuICAvKipcbiAgICogIyMjIC5sZW5ndGhPZihvYmplY3QsIGxlbmd0aCwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYG9iamVjdGAgaGFzIGEgYGxlbmd0aGAgcHJvcGVydHkgd2l0aCB0aGUgZXhwZWN0ZWQgdmFsdWUuXG4gICAqXG4gICAqICAgICBhc3NlcnQubGVuZ3RoT2YoWzEsMiwzXSwgMywgJ2FycmF5IGhhcyBsZW5ndGggb2YgMycpO1xuICAgKiAgICAgYXNzZXJ0Lmxlbmd0aE9mKCdmb29iYXInLCA1LCAnc3RyaW5nIGhhcyBsZW5ndGggb2YgNicpO1xuICAgKlxuICAgKiBAbmFtZSBsZW5ndGhPZlxuICAgKiBAcGFyYW0ge01peGVkfSBvYmplY3RcbiAgICogQHBhcmFtIHtOdW1iZXJ9IGxlbmd0aFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZVxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQubGVuZ3RoT2YgPSBmdW5jdGlvbiAoZXhwLCBsZW4sIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24oZXhwLCBtc2cpLnRvLmhhdmUubGVuZ3RoKGxlbik7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAudGhyb3dzKGZ1bmN0aW9uLCBbY29uc3RydWN0b3Ivc3RyaW5nL3JlZ2V4cF0sIFtzdHJpbmcvcmVnZXhwXSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYGZ1bmN0aW9uYCB3aWxsIHRocm93IGFuIGVycm9yIHRoYXQgaXMgYW4gaW5zdGFuY2Ugb2ZcbiAgICogYGNvbnN0cnVjdG9yYCwgb3IgYWx0ZXJuYXRlbHkgdGhhdCBpdCB3aWxsIHRocm93IGFuIGVycm9yIHdpdGggbWVzc2FnZVxuICAgKiBtYXRjaGluZyBgcmVnZXhwYC5cbiAgICpcbiAgICogICAgIGFzc2VydC50aHJvdyhmbiwgJ2Z1bmN0aW9uIHRocm93cyBhIHJlZmVyZW5jZSBlcnJvcicpO1xuICAgKiAgICAgYXNzZXJ0LnRocm93KGZuLCAvZnVuY3Rpb24gdGhyb3dzIGEgcmVmZXJlbmNlIGVycm9yLyk7XG4gICAqICAgICBhc3NlcnQudGhyb3coZm4sIFJlZmVyZW5jZUVycm9yKTtcbiAgICogICAgIGFzc2VydC50aHJvdyhmbiwgUmVmZXJlbmNlRXJyb3IsICdmdW5jdGlvbiB0aHJvd3MgYSByZWZlcmVuY2UgZXJyb3InKTtcbiAgICogICAgIGFzc2VydC50aHJvdyhmbiwgUmVmZXJlbmNlRXJyb3IsIC9mdW5jdGlvbiB0aHJvd3MgYSByZWZlcmVuY2UgZXJyb3IvKTtcbiAgICpcbiAgICogQG5hbWUgdGhyb3dzXG4gICAqIEBhbGlhcyB0aHJvd1xuICAgKiBAYWxpYXMgVGhyb3dcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuY3Rpb25cbiAgICogQHBhcmFtIHtFcnJvckNvbnN0cnVjdG9yfSBjb25zdHJ1Y3RvclxuICAgKiBAcGFyYW0ge1JlZ0V4cH0gcmVnZXhwXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBzZWUgaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4vSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvRXJyb3IjRXJyb3JfdHlwZXNcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LlRocm93ID0gZnVuY3Rpb24gKGZuLCBlcnJ0LCBlcnJzLCBtc2cpIHtcbiAgICBpZiAoJ3N0cmluZycgPT09IHR5cGVvZiBlcnJ0IHx8IGVycnQgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIGVycnMgPSBlcnJ0O1xuICAgICAgZXJydCA9IG51bGw7XG4gICAgfVxuXG4gICAgdmFyIGFzc2VydEVyciA9IG5ldyBBc3NlcnRpb24oZm4sIG1zZykudG8uVGhyb3coZXJydCwgZXJycyk7XG4gICAgcmV0dXJuIGZsYWcoYXNzZXJ0RXJyLCAnb2JqZWN0Jyk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuZG9lc05vdFRocm93KGZ1bmN0aW9uLCBbY29uc3RydWN0b3IvcmVnZXhwXSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYGZ1bmN0aW9uYCB3aWxsIF9ub3RfIHRocm93IGFuIGVycm9yIHRoYXQgaXMgYW4gaW5zdGFuY2Ugb2ZcbiAgICogYGNvbnN0cnVjdG9yYCwgb3IgYWx0ZXJuYXRlbHkgdGhhdCBpdCB3aWxsIG5vdCB0aHJvdyBhbiBlcnJvciB3aXRoIG1lc3NhZ2VcbiAgICogbWF0Y2hpbmcgYHJlZ2V4cGAuXG4gICAqXG4gICAqICAgICBhc3NlcnQuZG9lc05vdFRocm93KGZuLCBFcnJvciwgJ2Z1bmN0aW9uIGRvZXMgbm90IHRocm93Jyk7XG4gICAqXG4gICAqIEBuYW1lIGRvZXNOb3RUaHJvd1xuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jdGlvblxuICAgKiBAcGFyYW0ge0Vycm9yQ29uc3RydWN0b3J9IGNvbnN0cnVjdG9yXG4gICAqIEBwYXJhbSB7UmVnRXhwfSByZWdleHBcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQHNlZSBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9FcnJvciNFcnJvcl90eXBlc1xuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZG9lc05vdFRocm93ID0gZnVuY3Rpb24gKGZuLCB0eXBlLCBtc2cpIHtcbiAgICBpZiAoJ3N0cmluZycgPT09IHR5cGVvZiB0eXBlKSB7XG4gICAgICBtc2cgPSB0eXBlO1xuICAgICAgdHlwZSA9IG51bGw7XG4gICAgfVxuXG4gICAgbmV3IEFzc2VydGlvbihmbiwgbXNnKS50by5ub3QuVGhyb3codHlwZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAub3BlcmF0b3IodmFsMSwgb3BlcmF0b3IsIHZhbDIsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQ29tcGFyZXMgdHdvIHZhbHVlcyB1c2luZyBgb3BlcmF0b3JgLlxuICAgKlxuICAgKiAgICAgYXNzZXJ0Lm9wZXJhdG9yKDEsICc8JywgMiwgJ2V2ZXJ5dGhpbmcgaXMgb2snKTtcbiAgICogICAgIGFzc2VydC5vcGVyYXRvcigxLCAnPicsIDIsICd0aGlzIHdpbGwgZmFpbCcpO1xuICAgKlxuICAgKiBAbmFtZSBvcGVyYXRvclxuICAgKiBAcGFyYW0ge01peGVkfSB2YWwxXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBvcGVyYXRvclxuICAgKiBAcGFyYW0ge01peGVkfSB2YWwyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5vcGVyYXRvciA9IGZ1bmN0aW9uICh2YWwsIG9wZXJhdG9yLCB2YWwyLCBtc2cpIHtcbiAgICB2YXIgb2s7XG4gICAgc3dpdGNoKG9wZXJhdG9yKSB7XG4gICAgICBjYXNlICc9PSc6XG4gICAgICAgIG9rID0gdmFsID09IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnPT09JzpcbiAgICAgICAgb2sgPSB2YWwgPT09IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnPic6XG4gICAgICAgIG9rID0gdmFsID4gdmFsMjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICc+PSc6XG4gICAgICAgIG9rID0gdmFsID49IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnPCc6XG4gICAgICAgIG9rID0gdmFsIDwgdmFsMjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICc8PSc6XG4gICAgICAgIG9rID0gdmFsIDw9IHZhbDI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnIT0nOlxuICAgICAgICBvayA9IHZhbCAhPSB2YWwyO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJyE9PSc6XG4gICAgICAgIG9rID0gdmFsICE9PSB2YWwyO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBvcGVyYXRvciBcIicgKyBvcGVyYXRvciArICdcIicpO1xuICAgIH1cbiAgICB2YXIgdGVzdCA9IG5ldyBBc3NlcnRpb24ob2ssIG1zZyk7XG4gICAgdGVzdC5hc3NlcnQoXG4gICAgICAgIHRydWUgPT09IGZsYWcodGVzdCwgJ29iamVjdCcpXG4gICAgICAsICdleHBlY3RlZCAnICsgdXRpbC5pbnNwZWN0KHZhbCkgKyAnIHRvIGJlICcgKyBvcGVyYXRvciArICcgJyArIHV0aWwuaW5zcGVjdCh2YWwyKVxuICAgICAgLCAnZXhwZWN0ZWQgJyArIHV0aWwuaW5zcGVjdCh2YWwpICsgJyB0byBub3QgYmUgJyArIG9wZXJhdG9yICsgJyAnICsgdXRpbC5pbnNwZWN0KHZhbDIpICk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuY2xvc2VUbyhhY3R1YWwsIGV4cGVjdGVkLCBkZWx0YSwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgdGhlIHRhcmdldCBpcyBlcXVhbCBgZXhwZWN0ZWRgLCB0byB3aXRoaW4gYSArLy0gYGRlbHRhYCByYW5nZS5cbiAgICpcbiAgICogICAgIGFzc2VydC5jbG9zZVRvKDEuNSwgMSwgMC41LCAnbnVtYmVycyBhcmUgY2xvc2UnKTtcbiAgICpcbiAgICogQG5hbWUgY2xvc2VUb1xuICAgKiBAcGFyYW0ge051bWJlcn0gYWN0dWFsXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBleHBlY3RlZFxuICAgKiBAcGFyYW0ge051bWJlcn0gZGVsdGFcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmNsb3NlVG8gPSBmdW5jdGlvbiAoYWN0LCBleHAsIGRlbHRhLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGFjdCwgbXNnKS50by5iZS5jbG9zZVRvKGV4cCwgZGVsdGEpO1xuICB9O1xuXG4gIC8qKlxuICAgKiAjIyMgLnNhbWVNZW1iZXJzKHNldDEsIHNldDIsIFttZXNzYWdlXSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGBzZXQxYCBhbmQgYHNldDJgIGhhdmUgdGhlIHNhbWUgbWVtYmVycy5cbiAgICogT3JkZXIgaXMgbm90IHRha2VuIGludG8gYWNjb3VudC5cbiAgICpcbiAgICogICAgIGFzc2VydC5zYW1lTWVtYmVycyhbIDEsIDIsIDMgXSwgWyAyLCAxLCAzIF0sICdzYW1lIG1lbWJlcnMnKTtcbiAgICpcbiAgICogQG5hbWUgc2FtZU1lbWJlcnNcbiAgICogQHBhcmFtIHtBcnJheX0gc2V0MVxuICAgKiBAcGFyYW0ge0FycmF5fSBzZXQyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5zYW1lTWVtYmVycyA9IGZ1bmN0aW9uIChzZXQxLCBzZXQyLCBtc2cpIHtcbiAgICBuZXcgQXNzZXJ0aW9uKHNldDEsIG1zZykudG8uaGF2ZS5zYW1lLm1lbWJlcnMoc2V0Mik7XG4gIH1cblxuICAvKipcbiAgICogIyMjIC5zYW1lRGVlcE1lbWJlcnMoc2V0MSwgc2V0MiwgW21lc3NhZ2VdKVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYHNldDFgIGFuZCBgc2V0MmAgaGF2ZSB0aGUgc2FtZSBtZW1iZXJzIC0gdXNpbmcgYSBkZWVwIGVxdWFsaXR5IGNoZWNraW5nLlxuICAgKiBPcmRlciBpcyBub3QgdGFrZW4gaW50byBhY2NvdW50LlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LnNhbWVEZWVwTWVtYmVycyhbIHtiOiAzfSwge2E6IDJ9LCB7YzogNX0gXSwgWyB7YzogNX0sIHtiOiAzfSwge2E6IDJ9IF0sICdzYW1lIGRlZXAgbWVtYmVycycpO1xuICAgKlxuICAgKiBAbmFtZSBzYW1lRGVlcE1lbWJlcnNcbiAgICogQHBhcmFtIHtBcnJheX0gc2V0MVxuICAgKiBAcGFyYW0ge0FycmF5fSBzZXQyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5zYW1lRGVlcE1lbWJlcnMgPSBmdW5jdGlvbiAoc2V0MSwgc2V0MiwgbXNnKSB7XG4gICAgbmV3IEFzc2VydGlvbihzZXQxLCBtc2cpLnRvLmhhdmUuc2FtZS5kZWVwLm1lbWJlcnMoc2V0Mik7XG4gIH1cblxuICAvKipcbiAgICogIyMjIC5pbmNsdWRlTWVtYmVycyhzdXBlcnNldCwgc3Vic2V0LCBbbWVzc2FnZV0pXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBgc3Vic2V0YCBpcyBpbmNsdWRlZCBpbiBgc3VwZXJzZXRgLlxuICAgKiBPcmRlciBpcyBub3QgdGFrZW4gaW50byBhY2NvdW50LlxuICAgKlxuICAgKiAgICAgYXNzZXJ0LmluY2x1ZGVNZW1iZXJzKFsgMSwgMiwgMyBdLCBbIDIsIDEgXSwgJ2luY2x1ZGUgbWVtYmVycycpO1xuICAgKlxuICAgKiBAbmFtZSBpbmNsdWRlTWVtYmVyc1xuICAgKiBAcGFyYW0ge0FycmF5fSBzdXBlcnNldFxuICAgKiBAcGFyYW0ge0FycmF5fSBzdWJzZXRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmluY2x1ZGVNZW1iZXJzID0gZnVuY3Rpb24gKHN1cGVyc2V0LCBzdWJzZXQsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24oc3VwZXJzZXQsIG1zZykudG8uaW5jbHVkZS5tZW1iZXJzKHN1YnNldCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuY2hhbmdlcyhmdW5jdGlvbiwgb2JqZWN0LCBwcm9wZXJ0eSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGEgZnVuY3Rpb24gY2hhbmdlcyB0aGUgdmFsdWUgb2YgYSBwcm9wZXJ0eVxuICAgKlxuICAgKiAgICAgdmFyIG9iaiA9IHsgdmFsOiAxMCB9O1xuICAgKiAgICAgdmFyIGZuID0gZnVuY3Rpb24oKSB7IG9iai52YWwgPSAyMiB9O1xuICAgKiAgICAgYXNzZXJ0LmNoYW5nZXMoZm4sIG9iaiwgJ3ZhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBjaGFuZ2VzXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG1vZGlmaWVyIGZ1bmN0aW9uXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5IG5hbWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2UgX29wdGlvbmFsX1xuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuY2hhbmdlcyA9IGZ1bmN0aW9uIChmbiwgb2JqLCBwcm9wKSB7XG4gICAgbmV3IEFzc2VydGlvbihmbikudG8uY2hhbmdlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZG9lc05vdENoYW5nZShmdW5jdGlvbiwgb2JqZWN0LCBwcm9wZXJ0eSlcbiAgICpcbiAgICogQXNzZXJ0cyB0aGF0IGEgZnVuY3Rpb24gZG9lcyBub3QgY2hhbmdlcyB0aGUgdmFsdWUgb2YgYSBwcm9wZXJ0eVxuICAgKlxuICAgKiAgICAgdmFyIG9iaiA9IHsgdmFsOiAxMCB9O1xuICAgKiAgICAgdmFyIGZuID0gZnVuY3Rpb24oKSB7IGNvbnNvbGUubG9nKCdmb28nKTsgfTtcbiAgICogICAgIGFzc2VydC5kb2VzTm90Q2hhbmdlKGZuLCBvYmosICd2YWwnKTtcbiAgICpcbiAgICogQG5hbWUgZG9lc05vdENoYW5nZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBtb2RpZmllciBmdW5jdGlvblxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wZXJ0eSBuYW1lXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlIF9vcHRpb25hbF9cbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmRvZXNOb3RDaGFuZ2UgPSBmdW5jdGlvbiAoZm4sIG9iaiwgcHJvcCkge1xuICAgIG5ldyBBc3NlcnRpb24oZm4pLnRvLm5vdC5jaGFuZ2Uob2JqLCBwcm9wKTtcbiAgfVxuXG4gICAvKipcbiAgICogIyMjIC5pbmNyZWFzZXMoZnVuY3Rpb24sIG9iamVjdCwgcHJvcGVydHkpXG4gICAqXG4gICAqIEFzc2VydHMgdGhhdCBhIGZ1bmN0aW9uIGluY3JlYXNlcyBhbiBvYmplY3QgcHJvcGVydHlcbiAgICpcbiAgICogICAgIHZhciBvYmogPSB7IHZhbDogMTAgfTtcbiAgICogICAgIHZhciBmbiA9IGZ1bmN0aW9uKCkgeyBvYmoudmFsID0gMTMgfTtcbiAgICogICAgIGFzc2VydC5pbmNyZWFzZXMoZm4sIG9iaiwgJ3ZhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBpbmNyZWFzZXNcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbW9kaWZpZXIgZnVuY3Rpb25cbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHkgbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZSBfb3B0aW9uYWxfXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5pbmNyZWFzZXMgPSBmdW5jdGlvbiAoZm4sIG9iaiwgcHJvcCkge1xuICAgIG5ldyBBc3NlcnRpb24oZm4pLnRvLmluY3JlYXNlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZG9lc05vdEluY3JlYXNlKGZ1bmN0aW9uLCBvYmplY3QsIHByb3BlcnR5KVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYSBmdW5jdGlvbiBkb2VzIG5vdCBpbmNyZWFzZSBvYmplY3QgcHJvcGVydHlcbiAgICpcbiAgICogICAgIHZhciBvYmogPSB7IHZhbDogMTAgfTtcbiAgICogICAgIHZhciBmbiA9IGZ1bmN0aW9uKCkgeyBvYmoudmFsID0gOCB9O1xuICAgKiAgICAgYXNzZXJ0LmRvZXNOb3RJbmNyZWFzZShmbiwgb2JqLCAndmFsJyk7XG4gICAqXG4gICAqIEBuYW1lIGRvZXNOb3RJbmNyZWFzZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBtb2RpZmllciBmdW5jdGlvblxuICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wZXJ0eSBuYW1lXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlIF9vcHRpb25hbF9cbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgYXNzZXJ0LmRvZXNOb3RJbmNyZWFzZSA9IGZ1bmN0aW9uIChmbiwgb2JqLCBwcm9wKSB7XG4gICAgbmV3IEFzc2VydGlvbihmbikudG8ubm90LmluY3JlYXNlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZGVjcmVhc2VzKGZ1bmN0aW9uLCBvYmplY3QsIHByb3BlcnR5KVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYSBmdW5jdGlvbiBkZWNyZWFzZXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gICAqXG4gICAqICAgICB2YXIgb2JqID0geyB2YWw6IDEwIH07XG4gICAqICAgICB2YXIgZm4gPSBmdW5jdGlvbigpIHsgb2JqLnZhbCA9IDUgfTtcbiAgICogICAgIGFzc2VydC5kZWNyZWFzZXMoZm4sIG9iaiwgJ3ZhbCcpO1xuICAgKlxuICAgKiBAbmFtZSBkZWNyZWFzZXNcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbW9kaWZpZXIgZnVuY3Rpb25cbiAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcHJvcGVydHkgbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZSBfb3B0aW9uYWxfXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGFzc2VydC5kZWNyZWFzZXMgPSBmdW5jdGlvbiAoZm4sIG9iaiwgcHJvcCkge1xuICAgIG5ldyBBc3NlcnRpb24oZm4pLnRvLmRlY3JlYXNlKG9iaiwgcHJvcCk7XG4gIH1cblxuICAgLyoqXG4gICAqICMjIyAuZG9lc05vdERlY3JlYXNlKGZ1bmN0aW9uLCBvYmplY3QsIHByb3BlcnR5KVxuICAgKlxuICAgKiBBc3NlcnRzIHRoYXQgYSBmdW5jdGlvbiBkb2VzIG5vdCBkZWNyZWFzZXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gICAqXG4gICAqICAgICB2YXIgb2JqID0geyB2YWw6IDEwIH07XG4gICAqICAgICB2YXIgZm4gPSBmdW5jdGlvbigpIHsgb2JqLnZhbCA9IDE1IH07XG4gICAqICAgICBhc3NlcnQuZG9lc05vdERlY3JlYXNlKGZuLCBvYmosICd2YWwnKTtcbiAgICpcbiAgICogQG5hbWUgZG9lc05vdERlY3JlYXNlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG1vZGlmaWVyIGZ1bmN0aW9uXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAgICogQHBhcmFtIHtTdHJpbmd9IHByb3BlcnR5IG5hbWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2UgX29wdGlvbmFsX1xuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBhc3NlcnQuZG9lc05vdERlY3JlYXNlID0gZnVuY3Rpb24gKGZuLCBvYmosIHByb3ApIHtcbiAgICBuZXcgQXNzZXJ0aW9uKGZuKS50by5ub3QuZGVjcmVhc2Uob2JqLCBwcm9wKTtcbiAgfVxuXG4gIC8qIVxuICAgKiBVbmRvY3VtZW50ZWQgLyB1bnRlc3RlZFxuICAgKi9cblxuICBhc3NlcnQuaWZFcnJvciA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLm5vdC5iZS5vaztcbiAgfTtcblxuICAvKiFcbiAgICogQWxpYXNlcy5cbiAgICovXG5cbiAgKGZ1bmN0aW9uIGFsaWFzKG5hbWUsIGFzKXtcbiAgICBhc3NlcnRbYXNdID0gYXNzZXJ0W25hbWVdO1xuICAgIHJldHVybiBhbGlhcztcbiAgfSlcbiAgKCdUaHJvdycsICd0aHJvdycpXG4gICgnVGhyb3cnLCAndGhyb3dzJyk7XG59O1xuIiwiLyohXG4gKiBjaGFpXG4gKiBDb3B5cmlnaHQoYykgMjAxMS0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY2hhaSwgdXRpbCkge1xuICBjaGFpLmV4cGVjdCA9IGZ1bmN0aW9uICh2YWwsIG1lc3NhZ2UpIHtcbiAgICByZXR1cm4gbmV3IGNoYWkuQXNzZXJ0aW9uKHZhbCwgbWVzc2FnZSk7XG4gIH07XG5cbiAgLyoqXG4gICAqICMjIyAuZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBbbWVzc2FnZV0sIFtvcGVyYXRvcl0pXG4gICAqXG4gICAqIFRocm93IGEgZmFpbHVyZS5cbiAgICpcbiAgICogQG5hbWUgZmFpbFxuICAgKiBAcGFyYW0ge01peGVkfSBhY3R1YWxcbiAgICogQHBhcmFtIHtNaXhlZH0gZXhwZWN0ZWRcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICogQHBhcmFtIHtTdHJpbmd9IG9wZXJhdG9yXG4gICAqIEBhcGkgcHVibGljXG4gICAqL1xuXG4gIGNoYWkuZXhwZWN0LmZhaWwgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgb3BlcmF0b3IpIHtcbiAgICBtZXNzYWdlID0gbWVzc2FnZSB8fCAnZXhwZWN0LmZhaWwoKSc7XG4gICAgdGhyb3cgbmV3IGNoYWkuQXNzZXJ0aW9uRXJyb3IobWVzc2FnZSwge1xuICAgICAgICBhY3R1YWw6IGFjdHVhbFxuICAgICAgLCBleHBlY3RlZDogZXhwZWN0ZWRcbiAgICAgICwgb3BlcmF0b3I6IG9wZXJhdG9yXG4gICAgfSwgY2hhaS5leHBlY3QuZmFpbCk7XG4gIH07XG59O1xuIiwiLyohXG4gKiBjaGFpXG4gKiBDb3B5cmlnaHQoYykgMjAxMS0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY2hhaSwgdXRpbCkge1xuICB2YXIgQXNzZXJ0aW9uID0gY2hhaS5Bc3NlcnRpb247XG5cbiAgZnVuY3Rpb24gbG9hZFNob3VsZCAoKSB7XG4gICAgLy8gZXhwbGljaXRseSBkZWZpbmUgdGhpcyBtZXRob2QgYXMgZnVuY3Rpb24gYXMgdG8gaGF2ZSBpdCdzIG5hbWUgdG8gaW5jbHVkZSBhcyBgc3NmaWBcbiAgICBmdW5jdGlvbiBzaG91bGRHZXR0ZXIoKSB7XG4gICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIFN0cmluZyB8fCB0aGlzIGluc3RhbmNlb2YgTnVtYmVyIHx8IHRoaXMgaW5zdGFuY2VvZiBCb29sZWFuICkge1xuICAgICAgICByZXR1cm4gbmV3IEFzc2VydGlvbih0aGlzLnZhbHVlT2YoKSwgbnVsbCwgc2hvdWxkR2V0dGVyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgQXNzZXJ0aW9uKHRoaXMsIG51bGwsIHNob3VsZEdldHRlcik7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHNob3VsZFNldHRlcih2YWx1ZSkge1xuICAgICAgLy8gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9jaGFpanMvY2hhaS9pc3N1ZXMvODY6IHRoaXMgbWFrZXNcbiAgICAgIC8vIGB3aGF0ZXZlci5zaG91bGQgPSBzb21lVmFsdWVgIGFjdHVhbGx5IHNldCBgc29tZVZhbHVlYCwgd2hpY2ggaXNcbiAgICAgIC8vIGVzcGVjaWFsbHkgdXNlZnVsIGZvciBgZ2xvYmFsLnNob3VsZCA9IHJlcXVpcmUoJ2NoYWknKS5zaG91bGQoKWAuXG4gICAgICAvL1xuICAgICAgLy8gTm90ZSB0aGF0IHdlIGhhdmUgdG8gdXNlIFtbRGVmaW5lUHJvcGVydHldXSBpbnN0ZWFkIG9mIFtbUHV0XV1cbiAgICAgIC8vIHNpbmNlIG90aGVyd2lzZSB3ZSB3b3VsZCB0cmlnZ2VyIHRoaXMgdmVyeSBzZXR0ZXIhXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3Nob3VsZCcsIHtcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICAgIHdyaXRhYmxlOiB0cnVlXG4gICAgICB9KTtcbiAgICB9XG4gICAgLy8gbW9kaWZ5IE9iamVjdC5wcm90b3R5cGUgdG8gaGF2ZSBgc2hvdWxkYFxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShPYmplY3QucHJvdG90eXBlLCAnc2hvdWxkJywge1xuICAgICAgc2V0OiBzaG91bGRTZXR0ZXJcbiAgICAgICwgZ2V0OiBzaG91bGRHZXR0ZXJcbiAgICAgICwgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfSk7XG5cbiAgICB2YXIgc2hvdWxkID0ge307XG5cbiAgICAvKipcbiAgICAgKiAjIyMgLmZhaWwoYWN0dWFsLCBleHBlY3RlZCwgW21lc3NhZ2VdLCBbb3BlcmF0b3JdKVxuICAgICAqXG4gICAgICogVGhyb3cgYSBmYWlsdXJlLlxuICAgICAqXG4gICAgICogQG5hbWUgZmFpbFxuICAgICAqIEBwYXJhbSB7TWl4ZWR9IGFjdHVhbFxuICAgICAqIEBwYXJhbSB7TWl4ZWR9IGV4cGVjdGVkXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gb3BlcmF0b3JcbiAgICAgKiBAYXBpIHB1YmxpY1xuICAgICAqL1xuXG4gICAgc2hvdWxkLmZhaWwgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgb3BlcmF0b3IpIHtcbiAgICAgIG1lc3NhZ2UgPSBtZXNzYWdlIHx8ICdzaG91bGQuZmFpbCgpJztcbiAgICAgIHRocm93IG5ldyBjaGFpLkFzc2VydGlvbkVycm9yKG1lc3NhZ2UsIHtcbiAgICAgICAgICBhY3R1YWw6IGFjdHVhbFxuICAgICAgICAsIGV4cGVjdGVkOiBleHBlY3RlZFxuICAgICAgICAsIG9wZXJhdG9yOiBvcGVyYXRvclxuICAgICAgfSwgc2hvdWxkLmZhaWwpO1xuICAgIH07XG5cbiAgICBzaG91bGQuZXF1YWwgPSBmdW5jdGlvbiAodmFsMSwgdmFsMiwgbXNnKSB7XG4gICAgICBuZXcgQXNzZXJ0aW9uKHZhbDEsIG1zZykudG8uZXF1YWwodmFsMik7XG4gICAgfTtcblxuICAgIHNob3VsZC5UaHJvdyA9IGZ1bmN0aW9uIChmbiwgZXJydCwgZXJycywgbXNnKSB7XG4gICAgICBuZXcgQXNzZXJ0aW9uKGZuLCBtc2cpLnRvLlRocm93KGVycnQsIGVycnMpO1xuICAgIH07XG5cbiAgICBzaG91bGQuZXhpc3QgPSBmdW5jdGlvbiAodmFsLCBtc2cpIHtcbiAgICAgIG5ldyBBc3NlcnRpb24odmFsLCBtc2cpLnRvLmV4aXN0O1xuICAgIH1cblxuICAgIC8vIG5lZ2F0aW9uXG4gICAgc2hvdWxkLm5vdCA9IHt9XG5cbiAgICBzaG91bGQubm90LmVxdWFsID0gZnVuY3Rpb24gKHZhbDEsIHZhbDIsIG1zZykge1xuICAgICAgbmV3IEFzc2VydGlvbih2YWwxLCBtc2cpLnRvLm5vdC5lcXVhbCh2YWwyKTtcbiAgICB9O1xuXG4gICAgc2hvdWxkLm5vdC5UaHJvdyA9IGZ1bmN0aW9uIChmbiwgZXJydCwgZXJycywgbXNnKSB7XG4gICAgICBuZXcgQXNzZXJ0aW9uKGZuLCBtc2cpLnRvLm5vdC5UaHJvdyhlcnJ0LCBlcnJzKTtcbiAgICB9O1xuXG4gICAgc2hvdWxkLm5vdC5leGlzdCA9IGZ1bmN0aW9uICh2YWwsIG1zZykge1xuICAgICAgbmV3IEFzc2VydGlvbih2YWwsIG1zZykudG8ubm90LmV4aXN0O1xuICAgIH1cblxuICAgIHNob3VsZFsndGhyb3cnXSA9IHNob3VsZFsnVGhyb3cnXTtcbiAgICBzaG91bGQubm90Wyd0aHJvdyddID0gc2hvdWxkLm5vdFsnVGhyb3cnXTtcblxuICAgIHJldHVybiBzaG91bGQ7XG4gIH07XG5cbiAgY2hhaS5zaG91bGQgPSBsb2FkU2hvdWxkO1xuICBjaGFpLlNob3VsZCA9IGxvYWRTaG91bGQ7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gYWRkQ2hhaW5pbmdNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogTW9kdWxlIGRlcGVuZGVuY2llc1xuICovXG5cbnZhciB0cmFuc2ZlckZsYWdzID0gcmVxdWlyZSgnLi90cmFuc2ZlckZsYWdzJyk7XG52YXIgZmxhZyA9IHJlcXVpcmUoJy4vZmxhZycpO1xudmFyIGNvbmZpZyA9IHJlcXVpcmUoJy4uL2NvbmZpZycpO1xuXG4vKiFcbiAqIE1vZHVsZSB2YXJpYWJsZXNcbiAqL1xuXG4vLyBDaGVjayB3aGV0aGVyIGBfX3Byb3RvX19gIGlzIHN1cHBvcnRlZFxudmFyIGhhc1Byb3RvU3VwcG9ydCA9ICdfX3Byb3RvX18nIGluIE9iamVjdDtcblxuLy8gV2l0aG91dCBgX19wcm90b19fYCBzdXBwb3J0LCB0aGlzIG1vZHVsZSB3aWxsIG5lZWQgdG8gYWRkIHByb3BlcnRpZXMgdG8gYSBmdW5jdGlvbi5cbi8vIEhvd2V2ZXIsIHNvbWUgRnVuY3Rpb24ucHJvdG90eXBlIG1ldGhvZHMgY2Fubm90IGJlIG92ZXJ3cml0dGVuLFxuLy8gYW5kIHRoZXJlIHNlZW1zIG5vIGVhc3kgY3Jvc3MtcGxhdGZvcm0gd2F5IHRvIGRldGVjdCB0aGVtIChAc2VlIGNoYWlqcy9jaGFpL2lzc3Vlcy82OSkuXG52YXIgZXhjbHVkZU5hbWVzID0gL14oPzpsZW5ndGh8bmFtZXxhcmd1bWVudHN8Y2FsbGVyKSQvO1xuXG4vLyBDYWNoZSBgRnVuY3Rpb25gIHByb3BlcnRpZXNcbnZhciBjYWxsICA9IEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsLFxuICAgIGFwcGx5ID0gRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5O1xuXG4vKipcbiAqICMjIyBhZGRDaGFpbmFibGVNZXRob2QgKGN0eCwgbmFtZSwgbWV0aG9kLCBjaGFpbmluZ0JlaGF2aW9yKVxuICpcbiAqIEFkZHMgYSBtZXRob2QgdG8gYW4gb2JqZWN0LCBzdWNoIHRoYXQgdGhlIG1ldGhvZCBjYW4gYWxzbyBiZSBjaGFpbmVkLlxuICpcbiAqICAgICB1dGlscy5hZGRDaGFpbmFibGVNZXRob2QoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnZm9vJywgZnVuY3Rpb24gKHN0cikge1xuICogICAgICAgdmFyIG9iaiA9IHV0aWxzLmZsYWcodGhpcywgJ29iamVjdCcpO1xuICogICAgICAgbmV3IGNoYWkuQXNzZXJ0aW9uKG9iaikudG8uYmUuZXF1YWwoc3RyKTtcbiAqICAgICB9KTtcbiAqXG4gKiBDYW4gYWxzbyBiZSBhY2Nlc3NlZCBkaXJlY3RseSBmcm9tIGBjaGFpLkFzc2VydGlvbmAuXG4gKlxuICogICAgIGNoYWkuQXNzZXJ0aW9uLmFkZENoYWluYWJsZU1ldGhvZCgnZm9vJywgZm4sIGNoYWluaW5nQmVoYXZpb3IpO1xuICpcbiAqIFRoZSByZXN1bHQgY2FuIHRoZW4gYmUgdXNlZCBhcyBib3RoIGEgbWV0aG9kIGFzc2VydGlvbiwgZXhlY3V0aW5nIGJvdGggYG1ldGhvZGAgYW5kXG4gKiBgY2hhaW5pbmdCZWhhdmlvcmAsIG9yIGFzIGEgbGFuZ3VhZ2UgY2hhaW4sIHdoaWNoIG9ubHkgZXhlY3V0ZXMgYGNoYWluaW5nQmVoYXZpb3JgLlxuICpcbiAqICAgICBleHBlY3QoZm9vU3RyKS50by5iZS5mb28oJ2JhcicpO1xuICogICAgIGV4cGVjdChmb29TdHIpLnRvLmJlLmZvby5lcXVhbCgnZm9vJyk7XG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGN0eCBvYmplY3QgdG8gd2hpY2ggdGhlIG1ldGhvZCBpcyBhZGRlZFxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgbWV0aG9kIHRvIGFkZFxuICogQHBhcmFtIHtGdW5jdGlvbn0gbWV0aG9kIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIGBuYW1lYCwgd2hlbiBjYWxsZWRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNoYWluaW5nQmVoYXZpb3IgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIGV2ZXJ5IHRpbWUgdGhlIHByb3BlcnR5IGlzIGFjY2Vzc2VkXG4gKiBAbmFtZSBhZGRDaGFpbmFibGVNZXRob2RcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBtZXRob2QsIGNoYWluaW5nQmVoYXZpb3IpIHtcbiAgaWYgKHR5cGVvZiBjaGFpbmluZ0JlaGF2aW9yICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgY2hhaW5pbmdCZWhhdmlvciA9IGZ1bmN0aW9uICgpIHsgfTtcbiAgfVxuXG4gIHZhciBjaGFpbmFibGVCZWhhdmlvciA9IHtcbiAgICAgIG1ldGhvZDogbWV0aG9kXG4gICAgLCBjaGFpbmluZ0JlaGF2aW9yOiBjaGFpbmluZ0JlaGF2aW9yXG4gIH07XG5cbiAgLy8gc2F2ZSB0aGUgbWV0aG9kcyBzbyB3ZSBjYW4gb3ZlcndyaXRlIHRoZW0gbGF0ZXIsIGlmIHdlIG5lZWQgdG8uXG4gIGlmICghY3R4Ll9fbWV0aG9kcykge1xuICAgIGN0eC5fX21ldGhvZHMgPSB7fTtcbiAgfVxuICBjdHguX19tZXRob2RzW25hbWVdID0gY2hhaW5hYmxlQmVoYXZpb3I7XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGN0eCwgbmFtZSxcbiAgICB7IGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICBjaGFpbmFibGVCZWhhdmlvci5jaGFpbmluZ0JlaGF2aW9yLmNhbGwodGhpcyk7XG5cbiAgICAgICAgdmFyIGFzc2VydCA9IGZ1bmN0aW9uIGFzc2VydCgpIHtcbiAgICAgICAgICB2YXIgb2xkX3NzZmkgPSBmbGFnKHRoaXMsICdzc2ZpJyk7XG4gICAgICAgICAgaWYgKG9sZF9zc2ZpICYmIGNvbmZpZy5pbmNsdWRlU3RhY2sgPT09IGZhbHNlKVxuICAgICAgICAgICAgZmxhZyh0aGlzLCAnc3NmaScsIGFzc2VydCk7XG4gICAgICAgICAgdmFyIHJlc3VsdCA9IGNoYWluYWJsZUJlaGF2aW9yLm1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gVXNlIGBfX3Byb3RvX19gIGlmIGF2YWlsYWJsZVxuICAgICAgICBpZiAoaGFzUHJvdG9TdXBwb3J0KSB7XG4gICAgICAgICAgLy8gSW5oZXJpdCBhbGwgcHJvcGVydGllcyBmcm9tIHRoZSBvYmplY3QgYnkgcmVwbGFjaW5nIHRoZSBgRnVuY3Rpb25gIHByb3RvdHlwZVxuICAgICAgICAgIHZhciBwcm90b3R5cGUgPSBhc3NlcnQuX19wcm90b19fID0gT2JqZWN0LmNyZWF0ZSh0aGlzKTtcbiAgICAgICAgICAvLyBSZXN0b3JlIHRoZSBgY2FsbGAgYW5kIGBhcHBseWAgbWV0aG9kcyBmcm9tIGBGdW5jdGlvbmBcbiAgICAgICAgICBwcm90b3R5cGUuY2FsbCA9IGNhbGw7XG4gICAgICAgICAgcHJvdG90eXBlLmFwcGx5ID0gYXBwbHk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gT3RoZXJ3aXNlLCByZWRlZmluZSBhbGwgcHJvcGVydGllcyAoc2xvdyEpXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIHZhciBhc3NlcnRlck5hbWVzID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoY3R4KTtcbiAgICAgICAgICBhc3NlcnRlck5hbWVzLmZvckVhY2goZnVuY3Rpb24gKGFzc2VydGVyTmFtZSkge1xuICAgICAgICAgICAgaWYgKCFleGNsdWRlTmFtZXMudGVzdChhc3NlcnRlck5hbWUpKSB7XG4gICAgICAgICAgICAgIHZhciBwZCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoY3R4LCBhc3NlcnRlck5hbWUpO1xuICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoYXNzZXJ0LCBhc3NlcnRlck5hbWUsIHBkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyYW5zZmVyRmxhZ3ModGhpcywgYXNzZXJ0KTtcbiAgICAgICAgcmV0dXJuIGFzc2VydDtcbiAgICAgIH1cbiAgICAsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICB9KTtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBhZGRNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbnZhciBjb25maWcgPSByZXF1aXJlKCcuLi9jb25maWcnKTtcblxuLyoqXG4gKiAjIyMgLmFkZE1ldGhvZCAoY3R4LCBuYW1lLCBtZXRob2QpXG4gKlxuICogQWRkcyBhIG1ldGhvZCB0byB0aGUgcHJvdG90eXBlIG9mIGFuIG9iamVjdC5cbiAqXG4gKiAgICAgdXRpbHMuYWRkTWV0aG9kKGNoYWkuQXNzZXJ0aW9uLnByb3RvdHlwZSwgJ2ZvbycsIGZ1bmN0aW9uIChzdHIpIHtcbiAqICAgICAgIHZhciBvYmogPSB1dGlscy5mbGFnKHRoaXMsICdvYmplY3QnKTtcbiAqICAgICAgIG5ldyBjaGFpLkFzc2VydGlvbihvYmopLnRvLmJlLmVxdWFsKHN0cik7XG4gKiAgICAgfSk7XG4gKlxuICogQ2FuIGFsc28gYmUgYWNjZXNzZWQgZGlyZWN0bHkgZnJvbSBgY2hhaS5Bc3NlcnRpb25gLlxuICpcbiAqICAgICBjaGFpLkFzc2VydGlvbi5hZGRNZXRob2QoJ2ZvbycsIGZuKTtcbiAqXG4gKiBUaGVuIGNhbiBiZSB1c2VkIGFzIGFueSBvdGhlciBhc3NlcnRpb24uXG4gKlxuICogICAgIGV4cGVjdChmb29TdHIpLnRvLmJlLmZvbygnYmFyJyk7XG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGN0eCBvYmplY3QgdG8gd2hpY2ggdGhlIG1ldGhvZCBpcyBhZGRlZFxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgbWV0aG9kIHRvIGFkZFxuICogQHBhcmFtIHtGdW5jdGlvbn0gbWV0aG9kIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIG5hbWVcbiAqIEBuYW1lIGFkZE1ldGhvZFxuICogQGFwaSBwdWJsaWNcbiAqL1xudmFyIGZsYWcgPSByZXF1aXJlKCcuL2ZsYWcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBtZXRob2QpIHtcbiAgY3R4W25hbWVdID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBvbGRfc3NmaSA9IGZsYWcodGhpcywgJ3NzZmknKTtcbiAgICBpZiAob2xkX3NzZmkgJiYgY29uZmlnLmluY2x1ZGVTdGFjayA9PT0gZmFsc2UpXG4gICAgICBmbGFnKHRoaXMsICdzc2ZpJywgY3R4W25hbWVdKTtcbiAgICB2YXIgcmVzdWx0ID0gbWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gdW5kZWZpbmVkID8gdGhpcyA6IHJlc3VsdDtcbiAgfTtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBhZGRQcm9wZXJ0eSB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIyMgYWRkUHJvcGVydHkgKGN0eCwgbmFtZSwgZ2V0dGVyKVxuICpcbiAqIEFkZHMgYSBwcm9wZXJ0eSB0byB0aGUgcHJvdG90eXBlIG9mIGFuIG9iamVjdC5cbiAqXG4gKiAgICAgdXRpbHMuYWRkUHJvcGVydHkoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnZm9vJywgZnVuY3Rpb24gKCkge1xuICogICAgICAgdmFyIG9iaiA9IHV0aWxzLmZsYWcodGhpcywgJ29iamVjdCcpO1xuICogICAgICAgbmV3IGNoYWkuQXNzZXJ0aW9uKG9iaikudG8uYmUuaW5zdGFuY2VvZihGb28pO1xuICogICAgIH0pO1xuICpcbiAqIENhbiBhbHNvIGJlIGFjY2Vzc2VkIGRpcmVjdGx5IGZyb20gYGNoYWkuQXNzZXJ0aW9uYC5cbiAqXG4gKiAgICAgY2hhaS5Bc3NlcnRpb24uYWRkUHJvcGVydHkoJ2ZvbycsIGZuKTtcbiAqXG4gKiBUaGVuIGNhbiBiZSB1c2VkIGFzIGFueSBvdGhlciBhc3NlcnRpb24uXG4gKlxuICogICAgIGV4cGVjdChteUZvbykudG8uYmUuZm9vO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHRvIHdoaWNoIHRoZSBwcm9wZXJ0eSBpcyBhZGRlZFxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgcHJvcGVydHkgdG8gYWRkXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBnZXR0ZXIgZnVuY3Rpb24gdG8gYmUgdXNlZCBmb3IgbmFtZVxuICogQG5hbWUgYWRkUHJvcGVydHlcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBnZXR0ZXIpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGN0eCwgbmFtZSxcbiAgICB7IGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcmVzdWx0ID0gZ2V0dGVyLmNhbGwodGhpcyk7XG4gICAgICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gICAgICB9XG4gICAgLCBjb25maWd1cmFibGU6IHRydWVcbiAgfSk7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZmxhZyB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIyMgZmxhZyhvYmplY3QsIGtleSwgW3ZhbHVlXSlcbiAqXG4gKiBHZXQgb3Igc2V0IGEgZmxhZyB2YWx1ZSBvbiBhbiBvYmplY3QuIElmIGFcbiAqIHZhbHVlIGlzIHByb3ZpZGVkIGl0IHdpbGwgYmUgc2V0LCBlbHNlIGl0IHdpbGxcbiAqIHJldHVybiB0aGUgY3VycmVudGx5IHNldCB2YWx1ZSBvciBgdW5kZWZpbmVkYCBpZlxuICogdGhlIHZhbHVlIGlzIG5vdCBzZXQuXG4gKlxuICogICAgIHV0aWxzLmZsYWcodGhpcywgJ2ZvbycsICdiYXInKTsgLy8gc2V0dGVyXG4gKiAgICAgdXRpbHMuZmxhZyh0aGlzLCAnZm9vJyk7IC8vIGdldHRlciwgcmV0dXJucyBgYmFyYFxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgY29uc3RydWN0ZWQgQXNzZXJ0aW9uXG4gKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gKiBAcGFyYW0ge01peGVkfSB2YWx1ZSAob3B0aW9uYWwpXG4gKiBAbmFtZSBmbGFnXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmosIGtleSwgdmFsdWUpIHtcbiAgdmFyIGZsYWdzID0gb2JqLl9fZmxhZ3MgfHwgKG9iai5fX2ZsYWdzID0gT2JqZWN0LmNyZWF0ZShudWxsKSk7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAzKSB7XG4gICAgZmxhZ3Nba2V5XSA9IHZhbHVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBmbGFnc1trZXldO1xuICB9XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZ2V0QWN0dWFsIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBNSVQgTGljZW5zZWRcbiAqL1xuXG4vKipcbiAqICMgZ2V0QWN0dWFsKG9iamVjdCwgW2FjdHVhbF0pXG4gKlxuICogUmV0dXJucyB0aGUgYGFjdHVhbGAgdmFsdWUgZm9yIGFuIEFzc2VydGlvblxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgKGNvbnN0cnVjdGVkIEFzc2VydGlvbilcbiAqIEBwYXJhbSB7QXJndW1lbnRzfSBjaGFpLkFzc2VydGlvbi5wcm90b3R5cGUuYXNzZXJ0IGFyZ3VtZW50c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaiwgYXJncykge1xuICByZXR1cm4gYXJncy5sZW5ndGggPiA0ID8gYXJnc1s0XSA6IG9iai5fb2JqO1xufTtcbiIsIi8qIVxuICogQ2hhaSAtIGdldEVudW1lcmFibGVQcm9wZXJ0aWVzIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBNSVQgTGljZW5zZWRcbiAqL1xuXG4vKipcbiAqICMjIyAuZ2V0RW51bWVyYWJsZVByb3BlcnRpZXMob2JqZWN0KVxuICpcbiAqIFRoaXMgYWxsb3dzIHRoZSByZXRyaWV2YWwgb2YgZW51bWVyYWJsZSBwcm9wZXJ0eSBuYW1lcyBvZiBhbiBvYmplY3QsXG4gKiBpbmhlcml0ZWQgb3Igbm90LlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcbiAqIEByZXR1cm5zIHtBcnJheX1cbiAqIEBuYW1lIGdldEVudW1lcmFibGVQcm9wZXJ0aWVzXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZ2V0RW51bWVyYWJsZVByb3BlcnRpZXMob2JqZWN0KSB7XG4gIHZhciByZXN1bHQgPSBbXTtcbiAgZm9yICh2YXIgbmFtZSBpbiBvYmplY3QpIHtcbiAgICByZXN1bHQucHVzaChuYW1lKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufTtcbiIsIi8qIVxuICogQ2hhaSAtIG1lc3NhZ2UgY29tcG9zaXRpb24gdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogTW9kdWxlIGRlcGVuZGFuY2llc1xuICovXG5cbnZhciBmbGFnID0gcmVxdWlyZSgnLi9mbGFnJylcbiAgLCBnZXRBY3R1YWwgPSByZXF1aXJlKCcuL2dldEFjdHVhbCcpXG4gICwgaW5zcGVjdCA9IHJlcXVpcmUoJy4vaW5zcGVjdCcpXG4gICwgb2JqRGlzcGxheSA9IHJlcXVpcmUoJy4vb2JqRGlzcGxheScpO1xuXG4vKipcbiAqICMjIyAuZ2V0TWVzc2FnZShvYmplY3QsIG1lc3NhZ2UsIG5lZ2F0ZU1lc3NhZ2UpXG4gKlxuICogQ29uc3RydWN0IHRoZSBlcnJvciBtZXNzYWdlIGJhc2VkIG9uIGZsYWdzXG4gKiBhbmQgdGVtcGxhdGUgdGFncy4gVGVtcGxhdGUgdGFncyB3aWxsIHJldHVyblxuICogYSBzdHJpbmdpZmllZCBpbnNwZWN0aW9uIG9mIHRoZSBvYmplY3QgcmVmZXJlbmNlZC5cbiAqXG4gKiBNZXNzYWdlIHRlbXBsYXRlIHRhZ3M6XG4gKiAtIGAje3RoaXN9YCBjdXJyZW50IGFzc2VydGVkIG9iamVjdFxuICogLSBgI3thY3R9YCBhY3R1YWwgdmFsdWVcbiAqIC0gYCN7ZXhwfWAgZXhwZWN0ZWQgdmFsdWVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IChjb25zdHJ1Y3RlZCBBc3NlcnRpb24pXG4gKiBAcGFyYW0ge0FyZ3VtZW50c30gY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLmFzc2VydCBhcmd1bWVudHNcbiAqIEBuYW1lIGdldE1lc3NhZ2VcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqLCBhcmdzKSB7XG4gIHZhciBuZWdhdGUgPSBmbGFnKG9iaiwgJ25lZ2F0ZScpXG4gICAgLCB2YWwgPSBmbGFnKG9iaiwgJ29iamVjdCcpXG4gICAgLCBleHBlY3RlZCA9IGFyZ3NbM11cbiAgICAsIGFjdHVhbCA9IGdldEFjdHVhbChvYmosIGFyZ3MpXG4gICAgLCBtc2cgPSBuZWdhdGUgPyBhcmdzWzJdIDogYXJnc1sxXVxuICAgICwgZmxhZ01zZyA9IGZsYWcob2JqLCAnbWVzc2FnZScpO1xuXG4gIGlmKHR5cGVvZiBtc2cgPT09IFwiZnVuY3Rpb25cIikgbXNnID0gbXNnKCk7XG4gIG1zZyA9IG1zZyB8fCAnJztcbiAgbXNnID0gbXNnXG4gICAgLnJlcGxhY2UoLyN7dGhpc30vZywgb2JqRGlzcGxheSh2YWwpKVxuICAgIC5yZXBsYWNlKC8je2FjdH0vZywgb2JqRGlzcGxheShhY3R1YWwpKVxuICAgIC5yZXBsYWNlKC8je2V4cH0vZywgb2JqRGlzcGxheShleHBlY3RlZCkpO1xuXG4gIHJldHVybiBmbGFnTXNnID8gZmxhZ01zZyArICc6ICcgKyBtc2cgOiBtc2c7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZ2V0TmFtZSB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIGdldE5hbWUoZnVuYylcbiAqXG4gKiBHZXRzIHRoZSBuYW1lIG9mIGEgZnVuY3Rpb24sIGluIGEgY3Jvc3MtYnJvd3NlciB3YXkuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gYSBmdW5jdGlvbiAodXN1YWxseSBhIGNvbnN0cnVjdG9yKVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGZ1bmMpIHtcbiAgaWYgKGZ1bmMubmFtZSkgcmV0dXJuIGZ1bmMubmFtZTtcblxuICB2YXIgbWF0Y2ggPSAvXlxccz9mdW5jdGlvbiAoW14oXSopXFwoLy5leGVjKGZ1bmMpO1xuICByZXR1cm4gbWF0Y2ggJiYgbWF0Y2hbMV0gPyBtYXRjaFsxXSA6IFwiXCI7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gZ2V0UGF0aEluZm8gdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbnZhciBoYXNQcm9wZXJ0eSA9IHJlcXVpcmUoJy4vaGFzUHJvcGVydHknKTtcblxuLyoqXG4gKiAjIyMgLmdldFBhdGhJbmZvKHBhdGgsIG9iamVjdClcbiAqXG4gKiBUaGlzIGFsbG93cyB0aGUgcmV0cmlldmFsIG9mIHByb3BlcnR5IGluZm8gaW4gYW5cbiAqIG9iamVjdCBnaXZlbiBhIHN0cmluZyBwYXRoLlxuICpcbiAqIFRoZSBwYXRoIGluZm8gY29uc2lzdHMgb2YgYW4gb2JqZWN0IHdpdGggdGhlXG4gKiBmb2xsb3dpbmcgcHJvcGVydGllczpcbiAqXG4gKiAqIHBhcmVudCAtIFRoZSBwYXJlbnQgb2JqZWN0IG9mIHRoZSBwcm9wZXJ0eSByZWZlcmVuY2VkIGJ5IGBwYXRoYFxuICogKiBuYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGZpbmFsIHByb3BlcnR5LCBhIG51bWJlciBpZiBpdCB3YXMgYW4gYXJyYXkgaW5kZXhlclxuICogKiB2YWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgcHJvcGVydHksIGlmIGl0IGV4aXN0cywgb3RoZXJ3aXNlIGB1bmRlZmluZWRgXG4gKiAqIGV4aXN0cyAtIFdoZXRoZXIgdGhlIHByb3BlcnR5IGV4aXN0cyBvciBub3RcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICogQHJldHVybnMge09iamVjdH0gaW5mb1xuICogQG5hbWUgZ2V0UGF0aEluZm9cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBnZXRQYXRoSW5mbyhwYXRoLCBvYmopIHtcbiAgdmFyIHBhcnNlZCA9IHBhcnNlUGF0aChwYXRoKSxcbiAgICAgIGxhc3QgPSBwYXJzZWRbcGFyc2VkLmxlbmd0aCAtIDFdO1xuXG4gIHZhciBpbmZvID0ge1xuICAgIHBhcmVudDogcGFyc2VkLmxlbmd0aCA+IDEgPyBfZ2V0UGF0aFZhbHVlKHBhcnNlZCwgb2JqLCBwYXJzZWQubGVuZ3RoIC0gMSkgOiBvYmosXG4gICAgbmFtZTogbGFzdC5wIHx8IGxhc3QuaSxcbiAgICB2YWx1ZTogX2dldFBhdGhWYWx1ZShwYXJzZWQsIG9iaiksXG4gIH07XG4gIGluZm8uZXhpc3RzID0gaGFzUHJvcGVydHkoaW5mby5uYW1lLCBpbmZvLnBhcmVudCk7XG5cbiAgcmV0dXJuIGluZm87XG59O1xuXG5cbi8qIVxuICogIyMgcGFyc2VQYXRoKHBhdGgpXG4gKlxuICogSGVscGVyIGZ1bmN0aW9uIHVzZWQgdG8gcGFyc2Ugc3RyaW5nIG9iamVjdFxuICogcGF0aHMuIFVzZSBpbiBjb25qdW5jdGlvbiB3aXRoIGBfZ2V0UGF0aFZhbHVlYC5cbiAqXG4gKiAgICAgIHZhciBwYXJzZWQgPSBwYXJzZVBhdGgoJ215b2JqZWN0LnByb3BlcnR5LnN1YnByb3AnKTtcbiAqXG4gKiAjIyMgUGF0aHM6XG4gKlxuICogKiBDYW4gYmUgYXMgbmVhciBpbmZpbml0ZWx5IGRlZXAgYW5kIG5lc3RlZFxuICogKiBBcnJheXMgYXJlIGFsc28gdmFsaWQgdXNpbmcgdGhlIGZvcm1hbCBgbXlvYmplY3QuZG9jdW1lbnRbM10ucHJvcGVydHlgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBwYXJzZWRcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHBhcnNlUGF0aCAocGF0aCkge1xuICB2YXIgc3RyID0gcGF0aC5yZXBsYWNlKC9cXFsvZywgJy5bJylcbiAgICAsIHBhcnRzID0gc3RyLm1hdGNoKC8oXFxcXFxcLnxbXi5dKz8pKy9nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcChmdW5jdGlvbiAodmFsdWUpIHtcbiAgICB2YXIgcmUgPSAvXFxbKFxcZCspXFxdJC9cbiAgICAgICwgbUFyciA9IHJlLmV4ZWModmFsdWUpO1xuICAgIGlmIChtQXJyKSByZXR1cm4geyBpOiBwYXJzZUZsb2F0KG1BcnJbMV0pIH07XG4gICAgZWxzZSByZXR1cm4geyBwOiB2YWx1ZSB9O1xuICB9KTtcbn1cblxuXG4vKiFcbiAqICMjIF9nZXRQYXRoVmFsdWUocGFyc2VkLCBvYmopXG4gKlxuICogSGVscGVyIGNvbXBhbmlvbiBmdW5jdGlvbiBmb3IgYC5wYXJzZVBhdGhgIHRoYXQgcmV0dXJuc1xuICogdGhlIHZhbHVlIGxvY2F0ZWQgYXQgdGhlIHBhcnNlZCBhZGRyZXNzLlxuICpcbiAqICAgICAgdmFyIHZhbHVlID0gZ2V0UGF0aFZhbHVlKHBhcnNlZCwgb2JqKTtcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFyc2VkIGRlZmluaXRpb24gZnJvbSBgcGFyc2VQYXRoYC5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgdG8gc2VhcmNoIGFnYWluc3RcbiAqIEBwYXJhbSB7TnVtYmVyfSBvYmplY3QgdG8gc2VhcmNoIGFnYWluc3RcbiAqIEByZXR1cm5zIHtPYmplY3R8VW5kZWZpbmVkfSB2YWx1ZVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gX2dldFBhdGhWYWx1ZSAocGFyc2VkLCBvYmosIGluZGV4KSB7XG4gIHZhciB0bXAgPSBvYmpcbiAgICAsIHJlcztcblxuICBpbmRleCA9IChpbmRleCA9PT0gdW5kZWZpbmVkID8gcGFyc2VkLmxlbmd0aCA6IGluZGV4KTtcblxuICBmb3IgKHZhciBpID0gMCwgbCA9IGluZGV4OyBpIDwgbDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJzZWRbaV07XG4gICAgaWYgKHRtcCkge1xuICAgICAgaWYgKCd1bmRlZmluZWQnICE9PSB0eXBlb2YgcGFydC5wKVxuICAgICAgICB0bXAgPSB0bXBbcGFydC5wXTtcbiAgICAgIGVsc2UgaWYgKCd1bmRlZmluZWQnICE9PSB0eXBlb2YgcGFydC5pKVxuICAgICAgICB0bXAgPSB0bXBbcGFydC5pXTtcbiAgICAgIGlmIChpID09IChsIC0gMSkpIHJlcyA9IHRtcDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzO1xufVxuIiwiLyohXG4gKiBDaGFpIC0gZ2V0UGF0aFZhbHVlIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9sb2dpY2FscGFyYWRveC9maWx0clxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxudmFyIGdldFBhdGhJbmZvID0gcmVxdWlyZSgnLi9nZXRQYXRoSW5mbycpO1xuXG4vKipcbiAqICMjIyAuZ2V0UGF0aFZhbHVlKHBhdGgsIG9iamVjdClcbiAqXG4gKiBUaGlzIGFsbG93cyB0aGUgcmV0cmlldmFsIG9mIHZhbHVlcyBpbiBhblxuICogb2JqZWN0IGdpdmVuIGEgc3RyaW5nIHBhdGguXG4gKlxuICogICAgIHZhciBvYmogPSB7XG4gKiAgICAgICAgIHByb3AxOiB7XG4gKiAgICAgICAgICAgICBhcnI6IFsnYScsICdiJywgJ2MnXVxuICogICAgICAgICAgICwgc3RyOiAnSGVsbG8nXG4gKiAgICAgICAgIH1cbiAqICAgICAgICwgcHJvcDI6IHtcbiAqICAgICAgICAgICAgIGFycjogWyB7IG5lc3RlZDogJ1VuaXZlcnNlJyB9IF1cbiAqICAgICAgICAgICAsIHN0cjogJ0hlbGxvIGFnYWluISdcbiAqICAgICAgICAgfVxuICogICAgIH1cbiAqXG4gKiBUaGUgZm9sbG93aW5nIHdvdWxkIGJlIHRoZSByZXN1bHRzLlxuICpcbiAqICAgICBnZXRQYXRoVmFsdWUoJ3Byb3AxLnN0cicsIG9iaik7IC8vIEhlbGxvXG4gKiAgICAgZ2V0UGF0aFZhbHVlKCdwcm9wMS5hdHRbMl0nLCBvYmopOyAvLyBiXG4gKiAgICAgZ2V0UGF0aFZhbHVlKCdwcm9wMi5hcnJbMF0ubmVzdGVkJywgb2JqKTsgLy8gVW5pdmVyc2VcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICogQHJldHVybnMge09iamVjdH0gdmFsdWUgb3IgYHVuZGVmaW5lZGBcbiAqIEBuYW1lIGdldFBhdGhWYWx1ZVxuICogQGFwaSBwdWJsaWNcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihwYXRoLCBvYmopIHtcbiAgdmFyIGluZm8gPSBnZXRQYXRoSW5mbyhwYXRoLCBvYmopO1xuICByZXR1cm4gaW5mby52YWx1ZTtcbn07IFxuIiwiLyohXG4gKiBDaGFpIC0gZ2V0UHJvcGVydGllcyB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyoqXG4gKiAjIyMgLmdldFByb3BlcnRpZXMob2JqZWN0KVxuICpcbiAqIFRoaXMgYWxsb3dzIHRoZSByZXRyaWV2YWwgb2YgcHJvcGVydHkgbmFtZXMgb2YgYW4gb2JqZWN0LCBlbnVtZXJhYmxlIG9yIG5vdCxcbiAqIGluaGVyaXRlZCBvciBub3QuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxuICogQHJldHVybnMge0FycmF5fVxuICogQG5hbWUgZ2V0UHJvcGVydGllc1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGdldFByb3BlcnRpZXMob2JqZWN0KSB7XG4gIHZhciByZXN1bHQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhzdWJqZWN0KTtcblxuICBmdW5jdGlvbiBhZGRQcm9wZXJ0eShwcm9wZXJ0eSkge1xuICAgIGlmIChyZXN1bHQuaW5kZXhPZihwcm9wZXJ0eSkgPT09IC0xKSB7XG4gICAgICByZXN1bHQucHVzaChwcm9wZXJ0eSk7XG4gICAgfVxuICB9XG5cbiAgdmFyIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHN1YmplY3QpO1xuICB3aGlsZSAocHJvdG8gIT09IG51bGwpIHtcbiAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhwcm90bykuZm9yRWFjaChhZGRQcm9wZXJ0eSk7XG4gICAgcHJvdG8gPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG8pO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBoYXNQcm9wZXJ0eSB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxudmFyIHR5cGUgPSByZXF1aXJlKCcuL3R5cGUnKTtcblxuLyoqXG4gKiAjIyMgLmhhc1Byb3BlcnR5KG9iamVjdCwgbmFtZSlcbiAqXG4gKiBUaGlzIGFsbG93cyBjaGVja2luZyB3aGV0aGVyIGFuIG9iamVjdCBoYXNcbiAqIG5hbWVkIHByb3BlcnR5IG9yIG51bWVyaWMgYXJyYXkgaW5kZXguXG4gKlxuICogQmFzaWNhbGx5IGRvZXMgdGhlIHNhbWUgdGhpbmcgYXMgdGhlIGBpbmBcbiAqIG9wZXJhdG9yIGJ1dCB3b3JrcyBwcm9wZXJseSB3aXRoIG5hdGl2ZXNcbiAqIGFuZCBudWxsL3VuZGVmaW5lZCB2YWx1ZXMuXG4gKlxuICogICAgIHZhciBvYmogPSB7XG4gKiAgICAgICAgIGFycjogWydhJywgJ2InLCAnYyddXG4gKiAgICAgICAsIHN0cjogJ0hlbGxvJ1xuICogICAgIH1cbiAqXG4gKiBUaGUgZm9sbG93aW5nIHdvdWxkIGJlIHRoZSByZXN1bHRzLlxuICpcbiAqICAgICBoYXNQcm9wZXJ0eSgnc3RyJywgb2JqKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgnY29uc3RydWN0b3InLCBvYmopOyAgLy8gdHJ1ZVxuICogICAgIGhhc1Byb3BlcnR5KCdiYXInLCBvYmopOyAgLy8gZmFsc2VcbiAqICAgICBcbiAqICAgICBoYXNQcm9wZXJ0eSgnbGVuZ3RoJywgb2JqLnN0cik7IC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgxLCBvYmouc3RyKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSg1LCBvYmouc3RyKTsgIC8vIGZhbHNlXG4gKlxuICogICAgIGhhc1Byb3BlcnR5KCdsZW5ndGgnLCBvYmouYXJyKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgyLCBvYmouYXJyKTsgIC8vIHRydWVcbiAqICAgICBoYXNQcm9wZXJ0eSgzLCBvYmouYXJyKTsgIC8vIGZhbHNlXG4gKlxuICogQHBhcmFtIHtPYmp1ZWN0fSBvYmplY3RcbiAqIEBwYXJhbSB7U3RyaW5nfE51bWJlcn0gbmFtZVxuICogQHJldHVybnMge0Jvb2xlYW59IHdoZXRoZXIgaXQgZXhpc3RzXG4gKiBAbmFtZSBnZXRQYXRoSW5mb1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG52YXIgbGl0ZXJhbHMgPSB7XG4gICAgJ251bWJlcic6IE51bWJlclxuICAsICdzdHJpbmcnOiBTdHJpbmdcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaGFzUHJvcGVydHkobmFtZSwgb2JqKSB7XG4gIHZhciBvdCA9IHR5cGUob2JqKTtcblxuICAvLyBCYWQgT2JqZWN0LCBvYnZpb3VzbHkgbm8gcHJvcHMgYXQgYWxsXG4gIGlmKG90ID09PSAnbnVsbCcgfHwgb3QgPT09ICd1bmRlZmluZWQnKVxuICAgIHJldHVybiBmYWxzZTtcblxuICAvLyBUaGUgYGluYCBvcGVyYXRvciBkb2VzIG5vdCB3b3JrIHdpdGggY2VydGFpbiBsaXRlcmFsc1xuICAvLyBib3ggdGhlc2UgYmVmb3JlIHRoZSBjaGVja1xuICBpZihsaXRlcmFsc1tvdF0gJiYgdHlwZW9mIG9iaiAhPT0gJ29iamVjdCcpXG4gICAgb2JqID0gbmV3IGxpdGVyYWxzW290XShvYmopO1xuXG4gIHJldHVybiBuYW1lIGluIG9iajtcbn07XG4iLCIvKiFcbiAqIGNoYWlcbiAqIENvcHlyaWdodChjKSAyMDExIEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBNYWluIGV4cG9ydHNcbiAqL1xuXG52YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbi8qIVxuICogdGVzdCB1dGlsaXR5XG4gKi9cblxuZXhwb3J0cy50ZXN0ID0gcmVxdWlyZSgnLi90ZXN0Jyk7XG5cbi8qIVxuICogdHlwZSB1dGlsaXR5XG4gKi9cblxuZXhwb3J0cy50eXBlID0gcmVxdWlyZSgnLi90eXBlJyk7XG5cbi8qIVxuICogbWVzc2FnZSB1dGlsaXR5XG4gKi9cblxuZXhwb3J0cy5nZXRNZXNzYWdlID0gcmVxdWlyZSgnLi9nZXRNZXNzYWdlJyk7XG5cbi8qIVxuICogYWN0dWFsIHV0aWxpdHlcbiAqL1xuXG5leHBvcnRzLmdldEFjdHVhbCA9IHJlcXVpcmUoJy4vZ2V0QWN0dWFsJyk7XG5cbi8qIVxuICogSW5zcGVjdCB1dGlsXG4gKi9cblxuZXhwb3J0cy5pbnNwZWN0ID0gcmVxdWlyZSgnLi9pbnNwZWN0Jyk7XG5cbi8qIVxuICogT2JqZWN0IERpc3BsYXkgdXRpbFxuICovXG5cbmV4cG9ydHMub2JqRGlzcGxheSA9IHJlcXVpcmUoJy4vb2JqRGlzcGxheScpO1xuXG4vKiFcbiAqIEZsYWcgdXRpbGl0eVxuICovXG5cbmV4cG9ydHMuZmxhZyA9IHJlcXVpcmUoJy4vZmxhZycpO1xuXG4vKiFcbiAqIEZsYWcgdHJhbnNmZXJyaW5nIHV0aWxpdHlcbiAqL1xuXG5leHBvcnRzLnRyYW5zZmVyRmxhZ3MgPSByZXF1aXJlKCcuL3RyYW5zZmVyRmxhZ3MnKTtcblxuLyohXG4gKiBEZWVwIGVxdWFsIHV0aWxpdHlcbiAqL1xuXG5leHBvcnRzLmVxbCA9IHJlcXVpcmUoJ2RlZXAtZXFsJyk7XG5cbi8qIVxuICogRGVlcCBwYXRoIHZhbHVlXG4gKi9cblxuZXhwb3J0cy5nZXRQYXRoVmFsdWUgPSByZXF1aXJlKCcuL2dldFBhdGhWYWx1ZScpO1xuXG4vKiFcbiAqIERlZXAgcGF0aCBpbmZvXG4gKi9cblxuZXhwb3J0cy5nZXRQYXRoSW5mbyA9IHJlcXVpcmUoJy4vZ2V0UGF0aEluZm8nKTtcblxuLyohXG4gKiBDaGVjayBpZiBhIHByb3BlcnR5IGV4aXN0c1xuICovXG5cbmV4cG9ydHMuaGFzUHJvcGVydHkgPSByZXF1aXJlKCcuL2hhc1Byb3BlcnR5Jyk7XG5cbi8qIVxuICogRnVuY3Rpb24gbmFtZVxuICovXG5cbmV4cG9ydHMuZ2V0TmFtZSA9IHJlcXVpcmUoJy4vZ2V0TmFtZScpO1xuXG4vKiFcbiAqIGFkZCBQcm9wZXJ0eVxuICovXG5cbmV4cG9ydHMuYWRkUHJvcGVydHkgPSByZXF1aXJlKCcuL2FkZFByb3BlcnR5Jyk7XG5cbi8qIVxuICogYWRkIE1ldGhvZFxuICovXG5cbmV4cG9ydHMuYWRkTWV0aG9kID0gcmVxdWlyZSgnLi9hZGRNZXRob2QnKTtcblxuLyohXG4gKiBvdmVyd3JpdGUgUHJvcGVydHlcbiAqL1xuXG5leHBvcnRzLm92ZXJ3cml0ZVByb3BlcnR5ID0gcmVxdWlyZSgnLi9vdmVyd3JpdGVQcm9wZXJ0eScpO1xuXG4vKiFcbiAqIG92ZXJ3cml0ZSBNZXRob2RcbiAqL1xuXG5leHBvcnRzLm92ZXJ3cml0ZU1ldGhvZCA9IHJlcXVpcmUoJy4vb3ZlcndyaXRlTWV0aG9kJyk7XG5cbi8qIVxuICogQWRkIGEgY2hhaW5hYmxlIG1ldGhvZFxuICovXG5cbmV4cG9ydHMuYWRkQ2hhaW5hYmxlTWV0aG9kID0gcmVxdWlyZSgnLi9hZGRDaGFpbmFibGVNZXRob2QnKTtcblxuLyohXG4gKiBPdmVyd3JpdGUgY2hhaW5hYmxlIG1ldGhvZFxuICovXG5cbmV4cG9ydHMub3ZlcndyaXRlQ2hhaW5hYmxlTWV0aG9kID0gcmVxdWlyZSgnLi9vdmVyd3JpdGVDaGFpbmFibGVNZXRob2QnKTtcblxuIiwiLy8gVGhpcyBpcyAoYWxtb3N0KSBkaXJlY3RseSBmcm9tIE5vZGUuanMgdXRpbHNcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9qb3llbnQvbm9kZS9ibG9iL2Y4YzMzNWQwY2FmNDdmMTZkMzE0MTNmODlhYTI4ZWRhMzg3OGUzYWEvbGliL3V0aWwuanNcblxudmFyIGdldE5hbWUgPSByZXF1aXJlKCcuL2dldE5hbWUnKTtcbnZhciBnZXRQcm9wZXJ0aWVzID0gcmVxdWlyZSgnLi9nZXRQcm9wZXJ0aWVzJyk7XG52YXIgZ2V0RW51bWVyYWJsZVByb3BlcnRpZXMgPSByZXF1aXJlKCcuL2dldEVudW1lcmFibGVQcm9wZXJ0aWVzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gaW5zcGVjdDtcblxuLyoqXG4gKiBFY2hvcyB0aGUgdmFsdWUgb2YgYSB2YWx1ZS4gVHJ5cyB0byBwcmludCB0aGUgdmFsdWUgb3V0XG4gKiBpbiB0aGUgYmVzdCB3YXkgcG9zc2libGUgZ2l2ZW4gdGhlIGRpZmZlcmVudCB0eXBlcy5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqIFRoZSBvYmplY3QgdG8gcHJpbnQgb3V0LlxuICogQHBhcmFtIHtCb29sZWFufSBzaG93SGlkZGVuIEZsYWcgdGhhdCBzaG93cyBoaWRkZW4gKG5vdCBlbnVtZXJhYmxlKVxuICogICAgcHJvcGVydGllcyBvZiBvYmplY3RzLlxuICogQHBhcmFtIHtOdW1iZXJ9IGRlcHRoIERlcHRoIGluIHdoaWNoIHRvIGRlc2NlbmQgaW4gb2JqZWN0LiBEZWZhdWx0IGlzIDIuXG4gKiBAcGFyYW0ge0Jvb2xlYW59IGNvbG9ycyBGbGFnIHRvIHR1cm4gb24gQU5TSSBlc2NhcGUgY29kZXMgdG8gY29sb3IgdGhlXG4gKiAgICBvdXRwdXQuIERlZmF1bHQgaXMgZmFsc2UgKG5vIGNvbG9yaW5nKS5cbiAqL1xuZnVuY3Rpb24gaW5zcGVjdChvYmosIHNob3dIaWRkZW4sIGRlcHRoLCBjb2xvcnMpIHtcbiAgdmFyIGN0eCA9IHtcbiAgICBzaG93SGlkZGVuOiBzaG93SGlkZGVuLFxuICAgIHNlZW46IFtdLFxuICAgIHN0eWxpemU6IGZ1bmN0aW9uIChzdHIpIHsgcmV0dXJuIHN0cjsgfVxuICB9O1xuICByZXR1cm4gZm9ybWF0VmFsdWUoY3R4LCBvYmosICh0eXBlb2YgZGVwdGggPT09ICd1bmRlZmluZWQnID8gMiA6IGRlcHRoKSk7XG59XG5cbi8vIFJldHVybnMgdHJ1ZSBpZiBvYmplY3QgaXMgYSBET00gZWxlbWVudC5cbnZhciBpc0RPTUVsZW1lbnQgPSBmdW5jdGlvbiAob2JqZWN0KSB7XG4gIGlmICh0eXBlb2YgSFRNTEVsZW1lbnQgPT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG9iamVjdCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50O1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBvYmplY3QgJiZcbiAgICAgIHR5cGVvZiBvYmplY3QgPT09ICdvYmplY3QnICYmXG4gICAgICBvYmplY3Qubm9kZVR5cGUgPT09IDEgJiZcbiAgICAgIHR5cGVvZiBvYmplY3Qubm9kZU5hbWUgPT09ICdzdHJpbmcnO1xuICB9XG59O1xuXG5mdW5jdGlvbiBmb3JtYXRWYWx1ZShjdHgsIHZhbHVlLCByZWN1cnNlVGltZXMpIHtcbiAgLy8gUHJvdmlkZSBhIGhvb2sgZm9yIHVzZXItc3BlY2lmaWVkIGluc3BlY3QgZnVuY3Rpb25zLlxuICAvLyBDaGVjayB0aGF0IHZhbHVlIGlzIGFuIG9iamVjdCB3aXRoIGFuIGluc3BlY3QgZnVuY3Rpb24gb24gaXRcbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5pbnNwZWN0ID09PSAnZnVuY3Rpb24nICYmXG4gICAgICAvLyBGaWx0ZXIgb3V0IHRoZSB1dGlsIG1vZHVsZSwgaXQncyBpbnNwZWN0IGZ1bmN0aW9uIGlzIHNwZWNpYWxcbiAgICAgIHZhbHVlLmluc3BlY3QgIT09IGV4cG9ydHMuaW5zcGVjdCAmJlxuICAgICAgLy8gQWxzbyBmaWx0ZXIgb3V0IGFueSBwcm90b3R5cGUgb2JqZWN0cyB1c2luZyB0aGUgY2lyY3VsYXIgY2hlY2suXG4gICAgICAhKHZhbHVlLmNvbnN0cnVjdG9yICYmIHZhbHVlLmNvbnN0cnVjdG9yLnByb3RvdHlwZSA9PT0gdmFsdWUpKSB7XG4gICAgdmFyIHJldCA9IHZhbHVlLmluc3BlY3QocmVjdXJzZVRpbWVzKTtcbiAgICBpZiAodHlwZW9mIHJldCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldCA9IGZvcm1hdFZhbHVlKGN0eCwgcmV0LCByZWN1cnNlVGltZXMpO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xuICB9XG5cbiAgLy8gUHJpbWl0aXZlIHR5cGVzIGNhbm5vdCBoYXZlIHByb3BlcnRpZXNcbiAgdmFyIHByaW1pdGl2ZSA9IGZvcm1hdFByaW1pdGl2ZShjdHgsIHZhbHVlKTtcbiAgaWYgKHByaW1pdGl2ZSkge1xuICAgIHJldHVybiBwcmltaXRpdmU7XG4gIH1cblxuICAvLyBJZiB0aGlzIGlzIGEgRE9NIGVsZW1lbnQsIHRyeSB0byBnZXQgdGhlIG91dGVyIEhUTUwuXG4gIGlmIChpc0RPTUVsZW1lbnQodmFsdWUpKSB7XG4gICAgaWYgKCdvdXRlckhUTUwnIGluIHZhbHVlKSB7XG4gICAgICByZXR1cm4gdmFsdWUub3V0ZXJIVE1MO1xuICAgICAgLy8gVGhpcyB2YWx1ZSBkb2VzIG5vdCBoYXZlIGFuIG91dGVySFRNTCBhdHRyaWJ1dGUsXG4gICAgICAvLyAgIGl0IGNvdWxkIHN0aWxsIGJlIGFuIFhNTCBlbGVtZW50XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEF0dGVtcHQgdG8gc2VyaWFsaXplIGl0XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoZG9jdW1lbnQueG1sVmVyc2lvbikge1xuICAgICAgICAgIHZhciB4bWxTZXJpYWxpemVyID0gbmV3IFhNTFNlcmlhbGl6ZXIoKTtcbiAgICAgICAgICByZXR1cm4geG1sU2VyaWFsaXplci5zZXJpYWxpemVUb1N0cmluZyh2YWx1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRmlyZWZveCAxMS0gZG8gbm90IHN1cHBvcnQgb3V0ZXJIVE1MXG4gICAgICAgICAgLy8gICBJdCBkb2VzLCBob3dldmVyLCBzdXBwb3J0IGlubmVySFRNTFxuICAgICAgICAgIC8vICAgVXNlIHRoZSBmb2xsb3dpbmcgdG8gcmVuZGVyIHRoZSBlbGVtZW50XG4gICAgICAgICAgdmFyIG5zID0gXCJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hodG1sXCI7XG4gICAgICAgICAgdmFyIGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhucywgJ18nKTtcblxuICAgICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZCh2YWx1ZS5jbG9uZU5vZGUoZmFsc2UpKTtcbiAgICAgICAgICBodG1sID0gY29udGFpbmVyLmlubmVySFRNTFxuICAgICAgICAgICAgLnJlcGxhY2UoJz48JywgJz4nICsgdmFsdWUuaW5uZXJIVE1MICsgJzwnKTtcbiAgICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gJyc7XG4gICAgICAgICAgcmV0dXJuIGh0bWw7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAvLyBUaGlzIGNvdWxkIGJlIGEgbm9uLW5hdGl2ZSBET00gaW1wbGVtZW50YXRpb24sXG4gICAgICAgIC8vICAgY29udGludWUgd2l0aCB0aGUgbm9ybWFsIGZsb3c6XG4gICAgICAgIC8vICAgcHJpbnRpbmcgdGhlIGVsZW1lbnQgYXMgaWYgaXQgaXMgYW4gb2JqZWN0LlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIExvb2sgdXAgdGhlIGtleXMgb2YgdGhlIG9iamVjdC5cbiAgdmFyIHZpc2libGVLZXlzID0gZ2V0RW51bWVyYWJsZVByb3BlcnRpZXModmFsdWUpO1xuICB2YXIga2V5cyA9IGN0eC5zaG93SGlkZGVuID8gZ2V0UHJvcGVydGllcyh2YWx1ZSkgOiB2aXNpYmxlS2V5cztcblxuICAvLyBTb21lIHR5cGUgb2Ygb2JqZWN0IHdpdGhvdXQgcHJvcGVydGllcyBjYW4gYmUgc2hvcnRjdXR0ZWQuXG4gIC8vIEluIElFLCBlcnJvcnMgaGF2ZSBhIHNpbmdsZSBgc3RhY2tgIHByb3BlcnR5LCBvciBpZiB0aGV5IGFyZSB2YW5pbGxhIGBFcnJvcmAsXG4gIC8vIGEgYHN0YWNrYCBwbHVzIGBkZXNjcmlwdGlvbmAgcHJvcGVydHk7IGlnbm9yZSB0aG9zZSBmb3IgY29uc2lzdGVuY3kuXG4gIGlmIChrZXlzLmxlbmd0aCA9PT0gMCB8fCAoaXNFcnJvcih2YWx1ZSkgJiYgKFxuICAgICAgKGtleXMubGVuZ3RoID09PSAxICYmIGtleXNbMF0gPT09ICdzdGFjaycpIHx8XG4gICAgICAoa2V5cy5sZW5ndGggPT09IDIgJiYga2V5c1swXSA9PT0gJ2Rlc2NyaXB0aW9uJyAmJiBrZXlzWzFdID09PSAnc3RhY2snKVxuICAgICApKSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHZhciBuYW1lID0gZ2V0TmFtZSh2YWx1ZSk7XG4gICAgICB2YXIgbmFtZVN1ZmZpeCA9IG5hbWUgPyAnOiAnICsgbmFtZSA6ICcnO1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKCdbRnVuY3Rpb24nICsgbmFtZVN1ZmZpeCArICddJywgJ3NwZWNpYWwnKTtcbiAgICB9XG4gICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKFJlZ0V4cC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSksICdyZWdleHAnKTtcbiAgICB9XG4gICAgaWYgKGlzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBjdHguc3R5bGl6ZShEYXRlLnByb3RvdHlwZS50b1VUQ1N0cmluZy5jYWxsKHZhbHVlKSwgJ2RhdGUnKTtcbiAgICB9XG4gICAgaWYgKGlzRXJyb3IodmFsdWUpKSB7XG4gICAgICByZXR1cm4gZm9ybWF0RXJyb3IodmFsdWUpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBiYXNlID0gJycsIGFycmF5ID0gZmFsc2UsIGJyYWNlcyA9IFsneycsICd9J107XG5cbiAgLy8gTWFrZSBBcnJheSBzYXkgdGhhdCB0aGV5IGFyZSBBcnJheVxuICBpZiAoaXNBcnJheSh2YWx1ZSkpIHtcbiAgICBhcnJheSA9IHRydWU7XG4gICAgYnJhY2VzID0gWydbJywgJ10nXTtcbiAgfVxuXG4gIC8vIE1ha2UgZnVuY3Rpb25zIHNheSB0aGF0IHRoZXkgYXJlIGZ1bmN0aW9uc1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdmFyIG5hbWUgPSBnZXROYW1lKHZhbHVlKTtcbiAgICB2YXIgbmFtZVN1ZmZpeCA9IG5hbWUgPyAnOiAnICsgbmFtZSA6ICcnO1xuICAgIGJhc2UgPSAnIFtGdW5jdGlvbicgKyBuYW1lU3VmZml4ICsgJ10nO1xuICB9XG5cbiAgLy8gTWFrZSBSZWdFeHBzIHNheSB0aGF0IHRoZXkgYXJlIFJlZ0V4cHNcbiAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgIGJhc2UgPSAnICcgKyBSZWdFeHAucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpO1xuICB9XG5cbiAgLy8gTWFrZSBkYXRlcyB3aXRoIHByb3BlcnRpZXMgZmlyc3Qgc2F5IHRoZSBkYXRlXG4gIGlmIChpc0RhdGUodmFsdWUpKSB7XG4gICAgYmFzZSA9ICcgJyArIERhdGUucHJvdG90eXBlLnRvVVRDU3RyaW5nLmNhbGwodmFsdWUpO1xuICB9XG5cbiAgLy8gTWFrZSBlcnJvciB3aXRoIG1lc3NhZ2UgZmlyc3Qgc2F5IHRoZSBlcnJvclxuICBpZiAoaXNFcnJvcih2YWx1ZSkpIHtcbiAgICByZXR1cm4gZm9ybWF0RXJyb3IodmFsdWUpO1xuICB9XG5cbiAgaWYgKGtleXMubGVuZ3RoID09PSAwICYmICghYXJyYXkgfHwgdmFsdWUubGVuZ3RoID09IDApKSB7XG4gICAgcmV0dXJuIGJyYWNlc1swXSArIGJhc2UgKyBicmFjZXNbMV07XG4gIH1cblxuICBpZiAocmVjdXJzZVRpbWVzIDwgMCkge1xuICAgIGlmIChpc1JlZ0V4cCh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBjdHguc3R5bGl6ZShSZWdFeHAucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpLCAncmVnZXhwJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBjdHguc3R5bGl6ZSgnW09iamVjdF0nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgfVxuXG4gIGN0eC5zZWVuLnB1c2godmFsdWUpO1xuXG4gIHZhciBvdXRwdXQ7XG4gIGlmIChhcnJheSkge1xuICAgIG91dHB1dCA9IGZvcm1hdEFycmF5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleXMpO1xuICB9IGVsc2Uge1xuICAgIG91dHB1dCA9IGtleXMubWFwKGZ1bmN0aW9uKGtleSkge1xuICAgICAgcmV0dXJuIGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleSwgYXJyYXkpO1xuICAgIH0pO1xuICB9XG5cbiAgY3R4LnNlZW4ucG9wKCk7XG5cbiAgcmV0dXJuIHJlZHVjZVRvU2luZ2xlU3RyaW5nKG91dHB1dCwgYmFzZSwgYnJhY2VzKTtcbn1cblxuXG5mdW5jdGlvbiBmb3JtYXRQcmltaXRpdmUoY3R4LCB2YWx1ZSkge1xuICBzd2l0Y2ggKHR5cGVvZiB2YWx1ZSkge1xuICAgIGNhc2UgJ3VuZGVmaW5lZCc6XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJ3VuZGVmaW5lZCcsICd1bmRlZmluZWQnKTtcblxuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICB2YXIgc2ltcGxlID0gJ1xcJycgKyBKU09OLnN0cmluZ2lmeSh2YWx1ZSkucmVwbGFjZSgvXlwifFwiJC9nLCAnJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoLycvZywgXCJcXFxcJ1wiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvXFxcXFwiL2csICdcIicpICsgJ1xcJyc7XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoc2ltcGxlLCAnc3RyaW5nJyk7XG5cbiAgICBjYXNlICdudW1iZXInOlxuICAgICAgaWYgKHZhbHVlID09PSAwICYmICgxL3ZhbHVlKSA9PT0gLUluZmluaXR5KSB7XG4gICAgICAgIHJldHVybiBjdHguc3R5bGl6ZSgnLTAnLCAnbnVtYmVyJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ251bWJlcicpO1xuXG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ2Jvb2xlYW4nKTtcbiAgfVxuICAvLyBGb3Igc29tZSByZWFzb24gdHlwZW9mIG51bGwgaXMgXCJvYmplY3RcIiwgc28gc3BlY2lhbCBjYXNlIGhlcmUuXG4gIGlmICh2YWx1ZSA9PT0gbnVsbCkge1xuICAgIHJldHVybiBjdHguc3R5bGl6ZSgnbnVsbCcsICdudWxsJyk7XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBmb3JtYXRFcnJvcih2YWx1ZSkge1xuICByZXR1cm4gJ1snICsgRXJyb3IucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpICsgJ10nO1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdEFycmF5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleXMpIHtcbiAgdmFyIG91dHB1dCA9IFtdO1xuICBmb3IgKHZhciBpID0gMCwgbCA9IHZhbHVlLmxlbmd0aDsgaSA8IGw7ICsraSkge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodmFsdWUsIFN0cmluZyhpKSkpIHtcbiAgICAgIG91dHB1dC5wdXNoKGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsXG4gICAgICAgICAgU3RyaW5nKGkpLCB0cnVlKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG91dHB1dC5wdXNoKCcnKTtcbiAgICB9XG4gIH1cbiAga2V5cy5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIGlmICgha2V5Lm1hdGNoKC9eXFxkKyQvKSkge1xuICAgICAgb3V0cHV0LnB1c2goZm9ybWF0UHJvcGVydHkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cyxcbiAgICAgICAgICBrZXksIHRydWUpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gb3V0cHV0O1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsIGtleSwgYXJyYXkpIHtcbiAgdmFyIG5hbWUsIHN0cjtcbiAgaWYgKHZhbHVlLl9fbG9va3VwR2V0dGVyX18pIHtcbiAgICBpZiAodmFsdWUuX19sb29rdXBHZXR0ZXJfXyhrZXkpKSB7XG4gICAgICBpZiAodmFsdWUuX19sb29rdXBTZXR0ZXJfXyhrZXkpKSB7XG4gICAgICAgIHN0ciA9IGN0eC5zdHlsaXplKCdbR2V0dGVyL1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RyID0gY3R4LnN0eWxpemUoJ1tHZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHZhbHVlLl9fbG9va3VwU2V0dGVyX18oa2V5KSkge1xuICAgICAgICBzdHIgPSBjdHguc3R5bGl6ZSgnW1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAodmlzaWJsZUtleXMuaW5kZXhPZihrZXkpIDwgMCkge1xuICAgIG5hbWUgPSAnWycgKyBrZXkgKyAnXSc7XG4gIH1cbiAgaWYgKCFzdHIpIHtcbiAgICBpZiAoY3R4LnNlZW4uaW5kZXhPZih2YWx1ZVtrZXldKSA8IDApIHtcbiAgICAgIGlmIChyZWN1cnNlVGltZXMgPT09IG51bGwpIHtcbiAgICAgICAgc3RyID0gZm9ybWF0VmFsdWUoY3R4LCB2YWx1ZVtrZXldLCBudWxsKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0ciA9IGZvcm1hdFZhbHVlKGN0eCwgdmFsdWVba2V5XSwgcmVjdXJzZVRpbWVzIC0gMSk7XG4gICAgICB9XG4gICAgICBpZiAoc3RyLmluZGV4T2YoJ1xcbicpID4gLTEpIHtcbiAgICAgICAgaWYgKGFycmF5KSB7XG4gICAgICAgICAgc3RyID0gc3RyLnNwbGl0KCdcXG4nKS5tYXAoZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgICAgcmV0dXJuICcgICcgKyBsaW5lO1xuICAgICAgICAgIH0pLmpvaW4oJ1xcbicpLnN1YnN0cigyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzdHIgPSAnXFxuJyArIHN0ci5zcGxpdCgnXFxuJykubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICAgIHJldHVybiAnICAgJyArIGxpbmU7XG4gICAgICAgICAgfSkuam9pbignXFxuJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc3RyID0gY3R4LnN0eWxpemUoJ1tDaXJjdWxhcl0nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIG5hbWUgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKGFycmF5ICYmIGtleS5tYXRjaCgvXlxcZCskLykpIHtcbiAgICAgIHJldHVybiBzdHI7XG4gICAgfVxuICAgIG5hbWUgPSBKU09OLnN0cmluZ2lmeSgnJyArIGtleSk7XG4gICAgaWYgKG5hbWUubWF0Y2goL15cIihbYS16QS1aX11bYS16QS1aXzAtOV0qKVwiJC8pKSB7XG4gICAgICBuYW1lID0gbmFtZS5zdWJzdHIoMSwgbmFtZS5sZW5ndGggLSAyKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnbmFtZScpO1xuICAgIH0gZWxzZSB7XG4gICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgLnJlcGxhY2UoL1xcXFxcIi9nLCAnXCInKVxuICAgICAgICAgICAgICAgICAucmVwbGFjZSgvKF5cInxcIiQpL2csIFwiJ1wiKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnc3RyaW5nJyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5hbWUgKyAnOiAnICsgc3RyO1xufVxuXG5cbmZ1bmN0aW9uIHJlZHVjZVRvU2luZ2xlU3RyaW5nKG91dHB1dCwgYmFzZSwgYnJhY2VzKSB7XG4gIHZhciBudW1MaW5lc0VzdCA9IDA7XG4gIHZhciBsZW5ndGggPSBvdXRwdXQucmVkdWNlKGZ1bmN0aW9uKHByZXYsIGN1cikge1xuICAgIG51bUxpbmVzRXN0Kys7XG4gICAgaWYgKGN1ci5pbmRleE9mKCdcXG4nKSA+PSAwKSBudW1MaW5lc0VzdCsrO1xuICAgIHJldHVybiBwcmV2ICsgY3VyLmxlbmd0aCArIDE7XG4gIH0sIDApO1xuXG4gIGlmIChsZW5ndGggPiA2MCkge1xuICAgIHJldHVybiBicmFjZXNbMF0gK1xuICAgICAgICAgICAoYmFzZSA9PT0gJycgPyAnJyA6IGJhc2UgKyAnXFxuICcpICtcbiAgICAgICAgICAgJyAnICtcbiAgICAgICAgICAgb3V0cHV0LmpvaW4oJyxcXG4gICcpICtcbiAgICAgICAgICAgJyAnICtcbiAgICAgICAgICAgYnJhY2VzWzFdO1xuICB9XG5cbiAgcmV0dXJuIGJyYWNlc1swXSArIGJhc2UgKyAnICcgKyBvdXRwdXQuam9pbignLCAnKSArICcgJyArIGJyYWNlc1sxXTtcbn1cblxuZnVuY3Rpb24gaXNBcnJheShhcikge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShhcikgfHxcbiAgICAgICAgICh0eXBlb2YgYXIgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKGFyKSA9PT0gJ1tvYmplY3QgQXJyYXldJyk7XG59XG5cbmZ1bmN0aW9uIGlzUmVnRXhwKHJlKSB7XG4gIHJldHVybiB0eXBlb2YgcmUgPT09ICdvYmplY3QnICYmIG9iamVjdFRvU3RyaW5nKHJlKSA9PT0gJ1tvYmplY3QgUmVnRXhwXSc7XG59XG5cbmZ1bmN0aW9uIGlzRGF0ZShkKSB7XG4gIHJldHVybiB0eXBlb2YgZCA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoZCkgPT09ICdbb2JqZWN0IERhdGVdJztcbn1cblxuZnVuY3Rpb24gaXNFcnJvcihlKSB7XG4gIHJldHVybiB0eXBlb2YgZSA9PT0gJ29iamVjdCcgJiYgb2JqZWN0VG9TdHJpbmcoZSkgPT09ICdbb2JqZWN0IEVycm9yXSc7XG59XG5cbmZ1bmN0aW9uIG9iamVjdFRvU3RyaW5nKG8pIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKTtcbn1cbiIsIi8qIVxuICogQ2hhaSAtIGZsYWcgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogTW9kdWxlIGRlcGVuZGFuY2llc1xuICovXG5cbnZhciBpbnNwZWN0ID0gcmVxdWlyZSgnLi9pbnNwZWN0Jyk7XG52YXIgY29uZmlnID0gcmVxdWlyZSgnLi4vY29uZmlnJyk7XG5cbi8qKlxuICogIyMjIC5vYmpEaXNwbGF5IChvYmplY3QpXG4gKlxuICogRGV0ZXJtaW5lcyBpZiBhbiBvYmplY3Qgb3IgYW4gYXJyYXkgbWF0Y2hlc1xuICogY3JpdGVyaWEgdG8gYmUgaW5zcGVjdGVkIGluLWxpbmUgZm9yIGVycm9yXG4gKiBtZXNzYWdlcyBvciBzaG91bGQgYmUgdHJ1bmNhdGVkLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IGphdmFzY3JpcHQgb2JqZWN0IHRvIGluc3BlY3RcbiAqIEBuYW1lIG9iakRpc3BsYXlcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHZhciBzdHIgPSBpbnNwZWN0KG9iailcbiAgICAsIHR5cGUgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqKTtcblxuICBpZiAoY29uZmlnLnRydW5jYXRlVGhyZXNob2xkICYmIHN0ci5sZW5ndGggPj0gY29uZmlnLnRydW5jYXRlVGhyZXNob2xkKSB7XG4gICAgaWYgKHR5cGUgPT09ICdbb2JqZWN0IEZ1bmN0aW9uXScpIHtcbiAgICAgIHJldHVybiAhb2JqLm5hbWUgfHwgb2JqLm5hbWUgPT09ICcnXG4gICAgICAgID8gJ1tGdW5jdGlvbl0nXG4gICAgICAgIDogJ1tGdW5jdGlvbjogJyArIG9iai5uYW1lICsgJ10nO1xuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ1tvYmplY3QgQXJyYXldJykge1xuICAgICAgcmV0dXJuICdbIEFycmF5KCcgKyBvYmoubGVuZ3RoICsgJykgXSc7XG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnW29iamVjdCBPYmplY3RdJykge1xuICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhvYmopXG4gICAgICAgICwga3N0ciA9IGtleXMubGVuZ3RoID4gMlxuICAgICAgICAgID8ga2V5cy5zcGxpY2UoMCwgMikuam9pbignLCAnKSArICcsIC4uLidcbiAgICAgICAgICA6IGtleXMuam9pbignLCAnKTtcbiAgICAgIHJldHVybiAneyBPYmplY3QgKCcgKyBrc3RyICsgJykgfSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBzdHI7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBzdHI7XG4gIH1cbn07XG4iLCIvKiFcbiAqIENoYWkgLSBvdmVyd3JpdGVDaGFpbmFibGVNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIG92ZXJ3cml0ZUNoYWluYWJsZU1ldGhvZCAoY3R4LCBuYW1lLCBtZXRob2QsIGNoYWluaW5nQmVoYXZpb3IpXG4gKlxuICogT3ZlcndpdGVzIGFuIGFscmVhZHkgZXhpc3RpbmcgY2hhaW5hYmxlIG1ldGhvZFxuICogYW5kIHByb3ZpZGVzIGFjY2VzcyB0byB0aGUgcHJldmlvdXMgZnVuY3Rpb24gb3JcbiAqIHByb3BlcnR5LiAgTXVzdCByZXR1cm4gZnVuY3Rpb25zIHRvIGJlIHVzZWQgZm9yXG4gKiBuYW1lLlxuICpcbiAqICAgICB1dGlscy5vdmVyd3JpdGVDaGFpbmFibGVNZXRob2QoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnbGVuZ3RoJyxcbiAqICAgICAgIGZ1bmN0aW9uIChfc3VwZXIpIHtcbiAqICAgICAgIH1cbiAqICAgICAsIGZ1bmN0aW9uIChfc3VwZXIpIHtcbiAqICAgICAgIH1cbiAqICAgICApO1xuICpcbiAqIENhbiBhbHNvIGJlIGFjY2Vzc2VkIGRpcmVjdGx5IGZyb20gYGNoYWkuQXNzZXJ0aW9uYC5cbiAqXG4gKiAgICAgY2hhaS5Bc3NlcnRpb24ub3ZlcndyaXRlQ2hhaW5hYmxlTWV0aG9kKCdmb28nLCBmbiwgZm4pO1xuICpcbiAqIFRoZW4gY2FuIGJlIHVzZWQgYXMgYW55IG90aGVyIGFzc2VydGlvbi5cbiAqXG4gKiAgICAgZXhwZWN0KG15Rm9vKS50by5oYXZlLmxlbmd0aCgzKTtcbiAqICAgICBleHBlY3QobXlGb28pLnRvLmhhdmUubGVuZ3RoLmFib3ZlKDMpO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHdob3NlIG1ldGhvZCAvIHByb3BlcnR5IGlzIHRvIGJlIG92ZXJ3cml0dGVuXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBvZiBtZXRob2QgLyBwcm9wZXJ0eSB0byBvdmVyd3JpdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IG1ldGhvZCBmdW5jdGlvbiB0aGF0IHJldHVybnMgYSBmdW5jdGlvbiB0byBiZSB1c2VkIGZvciBuYW1lXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjaGFpbmluZ0JlaGF2aW9yIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIHByb3BlcnR5XG4gKiBAbmFtZSBvdmVyd3JpdGVDaGFpbmFibGVNZXRob2RcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBtZXRob2QsIGNoYWluaW5nQmVoYXZpb3IpIHtcbiAgdmFyIGNoYWluYWJsZUJlaGF2aW9yID0gY3R4Ll9fbWV0aG9kc1tuYW1lXTtcblxuICB2YXIgX2NoYWluaW5nQmVoYXZpb3IgPSBjaGFpbmFibGVCZWhhdmlvci5jaGFpbmluZ0JlaGF2aW9yO1xuICBjaGFpbmFibGVCZWhhdmlvci5jaGFpbmluZ0JlaGF2aW9yID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciByZXN1bHQgPSBjaGFpbmluZ0JlaGF2aW9yKF9jaGFpbmluZ0JlaGF2aW9yKS5jYWxsKHRoaXMpO1xuICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gIH07XG5cbiAgdmFyIF9tZXRob2QgPSBjaGFpbmFibGVCZWhhdmlvci5tZXRob2Q7XG4gIGNoYWluYWJsZUJlaGF2aW9yLm1ldGhvZCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcmVzdWx0ID0gbWV0aG9kKF9tZXRob2QpLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gdW5kZWZpbmVkID8gdGhpcyA6IHJlc3VsdDtcbiAgfTtcbn07XG4iLCIvKiFcbiAqIENoYWkgLSBvdmVyd3JpdGVNZXRob2QgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIG92ZXJ3cml0ZU1ldGhvZCAoY3R4LCBuYW1lLCBmbilcbiAqXG4gKiBPdmVyd2l0ZXMgYW4gYWxyZWFkeSBleGlzdGluZyBtZXRob2QgYW5kIHByb3ZpZGVzXG4gKiBhY2Nlc3MgdG8gcHJldmlvdXMgZnVuY3Rpb24uIE11c3QgcmV0dXJuIGZ1bmN0aW9uXG4gKiB0byBiZSB1c2VkIGZvciBuYW1lLlxuICpcbiAqICAgICB1dGlscy5vdmVyd3JpdGVNZXRob2QoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnZXF1YWwnLCBmdW5jdGlvbiAoX3N1cGVyKSB7XG4gKiAgICAgICByZXR1cm4gZnVuY3Rpb24gKHN0cikge1xuICogICAgICAgICB2YXIgb2JqID0gdXRpbHMuZmxhZyh0aGlzLCAnb2JqZWN0Jyk7XG4gKiAgICAgICAgIGlmIChvYmogaW5zdGFuY2VvZiBGb28pIHtcbiAqICAgICAgICAgICBuZXcgY2hhaS5Bc3NlcnRpb24ob2JqLnZhbHVlKS50by5lcXVhbChzdHIpO1xuICogICAgICAgICB9IGVsc2Uge1xuICogICAgICAgICAgIF9zdXBlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICogICAgICAgICB9XG4gKiAgICAgICB9XG4gKiAgICAgfSk7XG4gKlxuICogQ2FuIGFsc28gYmUgYWNjZXNzZWQgZGlyZWN0bHkgZnJvbSBgY2hhaS5Bc3NlcnRpb25gLlxuICpcbiAqICAgICBjaGFpLkFzc2VydGlvbi5vdmVyd3JpdGVNZXRob2QoJ2ZvbycsIGZuKTtcbiAqXG4gKiBUaGVuIGNhbiBiZSB1c2VkIGFzIGFueSBvdGhlciBhc3NlcnRpb24uXG4gKlxuICogICAgIGV4cGVjdChteUZvbykudG8uZXF1YWwoJ2JhcicpO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHdob3NlIG1ldGhvZCBpcyB0byBiZSBvdmVyd3JpdHRlblxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgb2YgbWV0aG9kIHRvIG92ZXJ3cml0ZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gbWV0aG9kIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIGZ1bmN0aW9uIHRvIGJlIHVzZWQgZm9yIG5hbWVcbiAqIEBuYW1lIG92ZXJ3cml0ZU1ldGhvZFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjdHgsIG5hbWUsIG1ldGhvZCkge1xuICB2YXIgX21ldGhvZCA9IGN0eFtuYW1lXVxuICAgICwgX3N1cGVyID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfTtcblxuICBpZiAoX21ldGhvZCAmJiAnZnVuY3Rpb24nID09PSB0eXBlb2YgX21ldGhvZClcbiAgICBfc3VwZXIgPSBfbWV0aG9kO1xuXG4gIGN0eFtuYW1lXSA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcmVzdWx0ID0gbWV0aG9kKF9zdXBlcikuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICByZXR1cm4gcmVzdWx0ID09PSB1bmRlZmluZWQgPyB0aGlzIDogcmVzdWx0O1xuICB9XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gb3ZlcndyaXRlUHJvcGVydHkgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIG92ZXJ3cml0ZVByb3BlcnR5IChjdHgsIG5hbWUsIGZuKVxuICpcbiAqIE92ZXJ3aXRlcyBhbiBhbHJlYWR5IGV4aXN0aW5nIHByb3BlcnR5IGdldHRlciBhbmQgcHJvdmlkZXNcbiAqIGFjY2VzcyB0byBwcmV2aW91cyB2YWx1ZS4gTXVzdCByZXR1cm4gZnVuY3Rpb24gdG8gdXNlIGFzIGdldHRlci5cbiAqXG4gKiAgICAgdXRpbHMub3ZlcndyaXRlUHJvcGVydHkoY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLCAnb2snLCBmdW5jdGlvbiAoX3N1cGVyKSB7XG4gKiAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICogICAgICAgICB2YXIgb2JqID0gdXRpbHMuZmxhZyh0aGlzLCAnb2JqZWN0Jyk7XG4gKiAgICAgICAgIGlmIChvYmogaW5zdGFuY2VvZiBGb28pIHtcbiAqICAgICAgICAgICBuZXcgY2hhaS5Bc3NlcnRpb24ob2JqLm5hbWUpLnRvLmVxdWFsKCdiYXInKTtcbiAqICAgICAgICAgfSBlbHNlIHtcbiAqICAgICAgICAgICBfc3VwZXIuY2FsbCh0aGlzKTtcbiAqICAgICAgICAgfVxuICogICAgICAgfVxuICogICAgIH0pO1xuICpcbiAqXG4gKiBDYW4gYWxzbyBiZSBhY2Nlc3NlZCBkaXJlY3RseSBmcm9tIGBjaGFpLkFzc2VydGlvbmAuXG4gKlxuICogICAgIGNoYWkuQXNzZXJ0aW9uLm92ZXJ3cml0ZVByb3BlcnR5KCdmb28nLCBmbik7XG4gKlxuICogVGhlbiBjYW4gYmUgdXNlZCBhcyBhbnkgb3RoZXIgYXNzZXJ0aW9uLlxuICpcbiAqICAgICBleHBlY3QobXlGb28pLnRvLmJlLm9rO1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBjdHggb2JqZWN0IHdob3NlIHByb3BlcnR5IGlzIHRvIGJlIG92ZXJ3cml0dGVuXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBvZiBwcm9wZXJ0eSB0byBvdmVyd3JpdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGdldHRlciBmdW5jdGlvbiB0aGF0IHJldHVybnMgYSBnZXR0ZXIgZnVuY3Rpb24gdG8gYmUgdXNlZCBmb3IgbmFtZVxuICogQG5hbWUgb3ZlcndyaXRlUHJvcGVydHlcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY3R4LCBuYW1lLCBnZXR0ZXIpIHtcbiAgdmFyIF9nZXQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKGN0eCwgbmFtZSlcbiAgICAsIF9zdXBlciA9IGZ1bmN0aW9uICgpIHt9O1xuXG4gIGlmIChfZ2V0ICYmICdmdW5jdGlvbicgPT09IHR5cGVvZiBfZ2V0LmdldClcbiAgICBfc3VwZXIgPSBfZ2V0LmdldFxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShjdHgsIG5hbWUsXG4gICAgeyBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IGdldHRlcihfc3VwZXIpLmNhbGwodGhpcyk7XG4gICAgICAgIHJldHVybiByZXN1bHQgPT09IHVuZGVmaW5lZCA/IHRoaXMgOiByZXN1bHQ7XG4gICAgICB9XG4gICAgLCBjb25maWd1cmFibGU6IHRydWVcbiAgfSk7XG59O1xuIiwiLyohXG4gKiBDaGFpIC0gdGVzdCB1dGlsaXR5XG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDE0IEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBNb2R1bGUgZGVwZW5kYW5jaWVzXG4gKi9cblxudmFyIGZsYWcgPSByZXF1aXJlKCcuL2ZsYWcnKTtcblxuLyoqXG4gKiAjIHRlc3Qob2JqZWN0LCBleHByZXNzaW9uKVxuICpcbiAqIFRlc3QgYW5kIG9iamVjdCBmb3IgZXhwcmVzc2lvbi5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IChjb25zdHJ1Y3RlZCBBc3NlcnRpb24pXG4gKiBAcGFyYW0ge0FyZ3VtZW50c30gY2hhaS5Bc3NlcnRpb24ucHJvdG90eXBlLmFzc2VydCBhcmd1bWVudHNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmosIGFyZ3MpIHtcbiAgdmFyIG5lZ2F0ZSA9IGZsYWcob2JqLCAnbmVnYXRlJylcbiAgICAsIGV4cHIgPSBhcmdzWzBdO1xuICByZXR1cm4gbmVnYXRlID8gIWV4cHIgOiBleHByO1xufTtcbiIsIi8qIVxuICogQ2hhaSAtIHRyYW5zZmVyRmxhZ3MgdXRpbGl0eVxuICogQ29weXJpZ2h0KGMpIDIwMTItMjAxNCBKYWtlIEx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogIyMjIHRyYW5zZmVyRmxhZ3MoYXNzZXJ0aW9uLCBvYmplY3QsIGluY2x1ZGVBbGwgPSB0cnVlKVxuICpcbiAqIFRyYW5zZmVyIGFsbCB0aGUgZmxhZ3MgZm9yIGBhc3NlcnRpb25gIHRvIGBvYmplY3RgLiBJZlxuICogYGluY2x1ZGVBbGxgIGlzIHNldCB0byBgZmFsc2VgLCB0aGVuIHRoZSBiYXNlIENoYWlcbiAqIGFzc2VydGlvbiBmbGFncyAobmFtZWx5IGBvYmplY3RgLCBgc3NmaWAsIGFuZCBgbWVzc2FnZWApXG4gKiB3aWxsIG5vdCBiZSB0cmFuc2ZlcnJlZC5cbiAqXG4gKlxuICogICAgIHZhciBuZXdBc3NlcnRpb24gPSBuZXcgQXNzZXJ0aW9uKCk7XG4gKiAgICAgdXRpbHMudHJhbnNmZXJGbGFncyhhc3NlcnRpb24sIG5ld0Fzc2VydGlvbik7XG4gKlxuICogICAgIHZhciBhbm90aGVyQXNzZXJpdG9uID0gbmV3IEFzc2VydGlvbihteU9iaik7XG4gKiAgICAgdXRpbHMudHJhbnNmZXJGbGFncyhhc3NlcnRpb24sIGFub3RoZXJBc3NlcnRpb24sIGZhbHNlKTtcbiAqXG4gKiBAcGFyYW0ge0Fzc2VydGlvbn0gYXNzZXJ0aW9uIHRoZSBhc3NlcnRpb24gdG8gdHJhbnNmZXIgdGhlIGZsYWdzIGZyb21cbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3QgdGhlIG9iamVjdCB0byB0cmFuc2ZlciB0aGUgZmxhZ3MgdG87IHVzdWFsbHkgYSBuZXcgYXNzZXJ0aW9uXG4gKiBAcGFyYW0ge0Jvb2xlYW59IGluY2x1ZGVBbGxcbiAqIEBuYW1lIHRyYW5zZmVyRmxhZ3NcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFzc2VydGlvbiwgb2JqZWN0LCBpbmNsdWRlQWxsKSB7XG4gIHZhciBmbGFncyA9IGFzc2VydGlvbi5fX2ZsYWdzIHx8IChhc3NlcnRpb24uX19mbGFncyA9IE9iamVjdC5jcmVhdGUobnVsbCkpO1xuXG4gIGlmICghb2JqZWN0Ll9fZmxhZ3MpIHtcbiAgICBvYmplY3QuX19mbGFncyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIH1cblxuICBpbmNsdWRlQWxsID0gYXJndW1lbnRzLmxlbmd0aCA9PT0gMyA/IGluY2x1ZGVBbGwgOiB0cnVlO1xuXG4gIGZvciAodmFyIGZsYWcgaW4gZmxhZ3MpIHtcbiAgICBpZiAoaW5jbHVkZUFsbCB8fFxuICAgICAgICAoZmxhZyAhPT0gJ29iamVjdCcgJiYgZmxhZyAhPT0gJ3NzZmknICYmIGZsYWcgIT0gJ21lc3NhZ2UnKSkge1xuICAgICAgb2JqZWN0Ll9fZmxhZ3NbZmxhZ10gPSBmbGFnc1tmbGFnXTtcbiAgICB9XG4gIH1cbn07XG4iLCIvKiFcbiAqIENoYWkgLSB0eXBlIHV0aWxpdHlcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTQgSmFrZSBMdWVyIDxqYWtlQGFsb2dpY2FscGFyYWRveC5jb20+XG4gKiBNSVQgTGljZW5zZWRcbiAqL1xuXG4vKiFcbiAqIERldGVjdGFibGUgamF2YXNjcmlwdCBuYXRpdmVzXG4gKi9cblxudmFyIG5hdGl2ZXMgPSB7XG4gICAgJ1tvYmplY3QgQXJndW1lbnRzXSc6ICdhcmd1bWVudHMnXG4gICwgJ1tvYmplY3QgQXJyYXldJzogJ2FycmF5J1xuICAsICdbb2JqZWN0IERhdGVdJzogJ2RhdGUnXG4gICwgJ1tvYmplY3QgRnVuY3Rpb25dJzogJ2Z1bmN0aW9uJ1xuICAsICdbb2JqZWN0IE51bWJlcl0nOiAnbnVtYmVyJ1xuICAsICdbb2JqZWN0IFJlZ0V4cF0nOiAncmVnZXhwJ1xuICAsICdbb2JqZWN0IFN0cmluZ10nOiAnc3RyaW5nJ1xufTtcblxuLyoqXG4gKiAjIyMgdHlwZShvYmplY3QpXG4gKlxuICogQmV0dGVyIGltcGxlbWVudGF0aW9uIG9mIGB0eXBlb2ZgIGRldGVjdGlvbiB0aGF0IGNhblxuICogYmUgdXNlZCBjcm9zcy1icm93c2VyLiBIYW5kbGVzIHRoZSBpbmNvbnNpc3RlbmNpZXMgb2ZcbiAqIEFycmF5LCBgbnVsbGAsIGFuZCBgdW5kZWZpbmVkYCBkZXRlY3Rpb24uXG4gKlxuICogICAgIHV0aWxzLnR5cGUoe30pIC8vICdvYmplY3QnXG4gKiAgICAgdXRpbHMudHlwZShudWxsKSAvLyBgbnVsbCdcbiAqICAgICB1dGlscy50eXBlKHVuZGVmaW5lZCkgLy8gYHVuZGVmaW5lZGBcbiAqICAgICB1dGlscy50eXBlKFtdKSAvLyBgYXJyYXlgXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gb2JqZWN0IHRvIGRldGVjdCB0eXBlIG9mXG4gKiBAbmFtZSB0eXBlXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcbiAgdmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopO1xuICBpZiAobmF0aXZlc1tzdHJdKSByZXR1cm4gbmF0aXZlc1tzdHJdO1xuICBpZiAob2JqID09PSBudWxsKSByZXR1cm4gJ251bGwnO1xuICBpZiAob2JqID09PSB1bmRlZmluZWQpIHJldHVybiAndW5kZWZpbmVkJztcbiAgaWYgKG9iaiA9PT0gT2JqZWN0KG9iaikpIHJldHVybiAnb2JqZWN0JztcbiAgcmV0dXJuIHR5cGVvZiBvYmo7XG59O1xuIiwiLyohXG4gKiBhc3NlcnRpb24tZXJyb3JcbiAqIENvcHlyaWdodChjKSAyMDEzIEpha2UgTHVlciA8amFrZUBxdWFsaWFuY3kuY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBSZXR1cm4gYSBmdW5jdGlvbiB0aGF0IHdpbGwgY29weSBwcm9wZXJ0aWVzIGZyb21cbiAqIG9uZSBvYmplY3QgdG8gYW5vdGhlciBleGNsdWRpbmcgYW55IG9yaWdpbmFsbHlcbiAqIGxpc3RlZC4gUmV0dXJuZWQgZnVuY3Rpb24gd2lsbCBjcmVhdGUgYSBuZXcgYHt9YC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXhjbHVkZWQgcHJvcGVydGllcyAuLi5cbiAqIEByZXR1cm4ge0Z1bmN0aW9ufVxuICovXG5cbmZ1bmN0aW9uIGV4Y2x1ZGUgKCkge1xuICB2YXIgZXhjbHVkZXMgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgZnVuY3Rpb24gZXhjbHVkZVByb3BzIChyZXMsIG9iaikge1xuICAgIE9iamVjdC5rZXlzKG9iaikuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICBpZiAoIX5leGNsdWRlcy5pbmRleE9mKGtleSkpIHJlc1trZXldID0gb2JqW2tleV07XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gZXh0ZW5kRXhjbHVkZSAoKSB7XG4gICAgdmFyIGFyZ3MgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cylcbiAgICAgICwgaSA9IDBcbiAgICAgICwgcmVzID0ge307XG5cbiAgICBmb3IgKDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGV4Y2x1ZGVQcm9wcyhyZXMsIGFyZ3NbaV0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXM7XG4gIH07XG59O1xuXG4vKiFcbiAqIFByaW1hcnkgRXhwb3J0c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gQXNzZXJ0aW9uRXJyb3I7XG5cbi8qKlxuICogIyMjIEFzc2VydGlvbkVycm9yXG4gKlxuICogQW4gZXh0ZW5zaW9uIG9mIHRoZSBKYXZhU2NyaXB0IGBFcnJvcmAgY29uc3RydWN0b3IgZm9yXG4gKiBhc3NlcnRpb24gYW5kIHZhbGlkYXRpb24gc2NlbmFyaW9zLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlXG4gKiBAcGFyYW0ge09iamVjdH0gcHJvcGVydGllcyB0byBpbmNsdWRlIChvcHRpb25hbClcbiAqIEBwYXJhbSB7Y2FsbGVlfSBzdGFydCBzdGFjayBmdW5jdGlvbiAob3B0aW9uYWwpXG4gKi9cblxuZnVuY3Rpb24gQXNzZXJ0aW9uRXJyb3IgKG1lc3NhZ2UsIF9wcm9wcywgc3NmKSB7XG4gIHZhciBleHRlbmQgPSBleGNsdWRlKCduYW1lJywgJ21lc3NhZ2UnLCAnc3RhY2snLCAnY29uc3RydWN0b3InLCAndG9KU09OJylcbiAgICAsIHByb3BzID0gZXh0ZW5kKF9wcm9wcyB8fCB7fSk7XG5cbiAgLy8gZGVmYXVsdCB2YWx1ZXNcbiAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZSB8fCAnVW5zcGVjaWZpZWQgQXNzZXJ0aW9uRXJyb3InO1xuICB0aGlzLnNob3dEaWZmID0gZmFsc2U7XG5cbiAgLy8gY29weSBmcm9tIHByb3BlcnRpZXNcbiAgZm9yICh2YXIga2V5IGluIHByb3BzKSB7XG4gICAgdGhpc1trZXldID0gcHJvcHNba2V5XTtcbiAgfVxuXG4gIC8vIGNhcHR1cmUgc3RhY2sgdHJhY2VcbiAgc3NmID0gc3NmIHx8IGFyZ3VtZW50cy5jYWxsZWU7XG4gIGlmIChzc2YgJiYgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UpIHtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCBzc2YpO1xuICB9XG59XG5cbi8qIVxuICogSW5oZXJpdCBmcm9tIEVycm9yLnByb3RvdHlwZVxuICovXG5cbkFzc2VydGlvbkVycm9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXJyb3IucHJvdG90eXBlKTtcblxuLyohXG4gKiBTdGF0aWNhbGx5IHNldCBuYW1lXG4gKi9cblxuQXNzZXJ0aW9uRXJyb3IucHJvdG90eXBlLm5hbWUgPSAnQXNzZXJ0aW9uRXJyb3InO1xuXG4vKiFcbiAqIEVuc3VyZSBjb3JyZWN0IGNvbnN0cnVjdG9yXG4gKi9cblxuQXNzZXJ0aW9uRXJyb3IucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gQXNzZXJ0aW9uRXJyb3I7XG5cbi8qKlxuICogQWxsb3cgZXJyb3JzIHRvIGJlIGNvbnZlcnRlZCB0byBKU09OIGZvciBzdGF0aWMgdHJhbnNmZXIuXG4gKlxuICogQHBhcmFtIHtCb29sZWFufSBpbmNsdWRlIHN0YWNrIChkZWZhdWx0OiBgdHJ1ZWApXG4gKiBAcmV0dXJuIHtPYmplY3R9IG9iamVjdCB0aGF0IGNhbiBiZSBgSlNPTi5zdHJpbmdpZnlgXG4gKi9cblxuQXNzZXJ0aW9uRXJyb3IucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIChzdGFjaykge1xuICB2YXIgZXh0ZW5kID0gZXhjbHVkZSgnY29uc3RydWN0b3InLCAndG9KU09OJywgJ3N0YWNrJylcbiAgICAsIHByb3BzID0gZXh0ZW5kKHsgbmFtZTogdGhpcy5uYW1lIH0sIHRoaXMpO1xuXG4gIC8vIGluY2x1ZGUgc3RhY2sgaWYgZXhpc3RzIGFuZCBub3QgdHVybmVkIG9mZlxuICBpZiAoZmFsc2UgIT09IHN0YWNrICYmIHRoaXMuc3RhY2spIHtcbiAgICBwcm9wcy5zdGFjayA9IHRoaXMuc3RhY2s7XG4gIH1cblxuICByZXR1cm4gcHJvcHM7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2xpYi9lcWwnKTtcbiIsIi8qIVxuICogZGVlcC1lcWxcbiAqIENvcHlyaWdodChjKSAyMDEzIEpha2UgTHVlciA8amFrZUBhbG9naWNhbHBhcmFkb3guY29tPlxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuLyohXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzXG4gKi9cblxudmFyIHR5cGUgPSByZXF1aXJlKCd0eXBlLWRldGVjdCcpO1xuXG4vKiFcbiAqIEJ1ZmZlci5pc0J1ZmZlciBicm93c2VyIHNoaW1cbiAqL1xuXG52YXIgQnVmZmVyO1xudHJ5IHsgQnVmZmVyID0gcmVxdWlyZSgnYnVmZmVyJykuQnVmZmVyOyB9XG5jYXRjaChleCkge1xuICBCdWZmZXIgPSB7fTtcbiAgQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24oKSB7IHJldHVybiBmYWxzZTsgfVxufVxuXG4vKiFcbiAqIFByaW1hcnkgRXhwb3J0XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBkZWVwRXF1YWw7XG5cbi8qKlxuICogQXNzZXJ0IHN1cGVyLXN0cmljdCAoZWdhbCkgZXF1YWxpdHkgYmV0d2VlblxuICogdHdvIG9iamVjdHMgb2YgYW55IHR5cGUuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gYVxuICogQHBhcmFtIHtNaXhlZH0gYlxuICogQHBhcmFtIHtBcnJheX0gbWVtb2lzZWQgKG9wdGlvbmFsKVxuICogQHJldHVybiB7Qm9vbGVhbn0gZXF1YWwgbWF0Y2hcbiAqL1xuXG5mdW5jdGlvbiBkZWVwRXF1YWwoYSwgYiwgbSkge1xuICBpZiAoc2FtZVZhbHVlKGEsIGIpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gZWxzZSBpZiAoJ2RhdGUnID09PSB0eXBlKGEpKSB7XG4gICAgcmV0dXJuIGRhdGVFcXVhbChhLCBiKTtcbiAgfSBlbHNlIGlmICgncmVnZXhwJyA9PT0gdHlwZShhKSkge1xuICAgIHJldHVybiByZWdleHBFcXVhbChhLCBiKTtcbiAgfSBlbHNlIGlmIChCdWZmZXIuaXNCdWZmZXIoYSkpIHtcbiAgICByZXR1cm4gYnVmZmVyRXF1YWwoYSwgYik7XG4gIH0gZWxzZSBpZiAoJ2FyZ3VtZW50cycgPT09IHR5cGUoYSkpIHtcbiAgICByZXR1cm4gYXJndW1lbnRzRXF1YWwoYSwgYiwgbSk7XG4gIH0gZWxzZSBpZiAoIXR5cGVFcXVhbChhLCBiKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSBlbHNlIGlmICgoJ29iamVjdCcgIT09IHR5cGUoYSkgJiYgJ29iamVjdCcgIT09IHR5cGUoYikpXG4gICYmICgnYXJyYXknICE9PSB0eXBlKGEpICYmICdhcnJheScgIT09IHR5cGUoYikpKSB7XG4gICAgcmV0dXJuIHNhbWVWYWx1ZShhLCBiKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqZWN0RXF1YWwoYSwgYiwgbSk7XG4gIH1cbn1cblxuLyohXG4gKiBTdHJpY3QgKGVnYWwpIGVxdWFsaXR5IHRlc3QuIEVuc3VyZXMgdGhhdCBOYU4gYWx3YXlzXG4gKiBlcXVhbHMgTmFOIGFuZCBgLTBgIGRvZXMgbm90IGVxdWFsIGArMGAuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gYVxuICogQHBhcmFtIHtNaXhlZH0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gZXF1YWwgbWF0Y2hcbiAqL1xuXG5mdW5jdGlvbiBzYW1lVmFsdWUoYSwgYikge1xuICBpZiAoYSA9PT0gYikgcmV0dXJuIGEgIT09IDAgfHwgMSAvIGEgPT09IDEgLyBiO1xuICByZXR1cm4gYSAhPT0gYSAmJiBiICE9PSBiO1xufVxuXG4vKiFcbiAqIENvbXBhcmUgdGhlIHR5cGVzIG9mIHR3byBnaXZlbiBvYmplY3RzIGFuZFxuICogcmV0dXJuIGlmIHRoZXkgYXJlIGVxdWFsLiBOb3RlIHRoYXQgYW4gQXJyYXlcbiAqIGhhcyBhIHR5cGUgb2YgYGFycmF5YCAobm90IGBvYmplY3RgKSBhbmQgYXJndW1lbnRzXG4gKiBoYXZlIGEgdHlwZSBvZiBgYXJndW1lbnRzYCAobm90IGBhcnJheWAvYG9iamVjdGApLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IGFcbiAqIEBwYXJhbSB7TWl4ZWR9IGJcbiAqIEByZXR1cm4ge0Jvb2xlYW59IHJlc3VsdFxuICovXG5cbmZ1bmN0aW9uIHR5cGVFcXVhbChhLCBiKSB7XG4gIHJldHVybiB0eXBlKGEpID09PSB0eXBlKGIpO1xufVxuXG4vKiFcbiAqIENvbXBhcmUgdHdvIERhdGUgb2JqZWN0cyBieSBhc3NlcnRpbmcgdGhhdFxuICogdGhlIHRpbWUgdmFsdWVzIGFyZSBlcXVhbCB1c2luZyBgc2F2ZVZhbHVlYC5cbiAqXG4gKiBAcGFyYW0ge0RhdGV9IGFcbiAqIEBwYXJhbSB7RGF0ZX0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gZGF0ZUVxdWFsKGEsIGIpIHtcbiAgaWYgKCdkYXRlJyAhPT0gdHlwZShiKSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gc2FtZVZhbHVlKGEuZ2V0VGltZSgpLCBiLmdldFRpbWUoKSk7XG59XG5cbi8qIVxuICogQ29tcGFyZSB0d28gcmVndWxhciBleHByZXNzaW9ucyBieSBjb252ZXJ0aW5nIHRoZW1cbiAqIHRvIHN0cmluZyBhbmQgY2hlY2tpbmcgZm9yIGBzYW1lVmFsdWVgLlxuICpcbiAqIEBwYXJhbSB7UmVnRXhwfSBhXG4gKiBAcGFyYW0ge1JlZ0V4cH0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gcmVnZXhwRXF1YWwoYSwgYikge1xuICBpZiAoJ3JlZ2V4cCcgIT09IHR5cGUoYikpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHNhbWVWYWx1ZShhLnRvU3RyaW5nKCksIGIudG9TdHJpbmcoKSk7XG59XG5cbi8qIVxuICogQXNzZXJ0IGRlZXAgZXF1YWxpdHkgb2YgdHdvIGBhcmd1bWVudHNgIG9iamVjdHMuXG4gKiBVbmZvcnR1bmF0ZWx5LCB0aGVzZSBtdXN0IGJlIHNsaWNlZCB0byBhcnJheXNcbiAqIHByaW9yIHRvIHRlc3QgdG8gZW5zdXJlIG5vIGJhZCBiZWhhdmlvci5cbiAqXG4gKiBAcGFyYW0ge0FyZ3VtZW50c30gYVxuICogQHBhcmFtIHtBcmd1bWVudHN9IGJcbiAqIEBwYXJhbSB7QXJyYXl9IG1lbW9pemUgKG9wdGlvbmFsKVxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gYXJndW1lbnRzRXF1YWwoYSwgYiwgbSkge1xuICBpZiAoJ2FyZ3VtZW50cycgIT09IHR5cGUoYikpIHJldHVybiBmYWxzZTtcbiAgYSA9IFtdLnNsaWNlLmNhbGwoYSk7XG4gIGIgPSBbXS5zbGljZS5jYWxsKGIpO1xuICByZXR1cm4gZGVlcEVxdWFsKGEsIGIsIG0pO1xufVxuXG4vKiFcbiAqIEdldCBlbnVtZXJhYmxlIHByb3BlcnRpZXMgb2YgYSBnaXZlbiBvYmplY3QuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGFcbiAqIEByZXR1cm4ge0FycmF5fSBwcm9wZXJ0eSBuYW1lc1xuICovXG5cbmZ1bmN0aW9uIGVudW1lcmFibGUoYSkge1xuICB2YXIgcmVzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBhKSByZXMucHVzaChrZXkpO1xuICByZXR1cm4gcmVzO1xufVxuXG4vKiFcbiAqIFNpbXBsZSBlcXVhbGl0eSBmb3IgZmxhdCBpdGVyYWJsZSBvYmplY3RzXG4gKiBzdWNoIGFzIEFycmF5cyBvciBOb2RlLmpzIGJ1ZmZlcnMuXG4gKlxuICogQHBhcmFtIHtJdGVyYWJsZX0gYVxuICogQHBhcmFtIHtJdGVyYWJsZX0gYlxuICogQHJldHVybiB7Qm9vbGVhbn0gcmVzdWx0XG4gKi9cblxuZnVuY3Rpb24gaXRlcmFibGVFcXVhbChhLCBiKSB7XG4gIGlmIChhLmxlbmd0aCAhPT0gIGIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIGkgPSAwO1xuICB2YXIgbWF0Y2ggPSB0cnVlO1xuXG4gIGZvciAoOyBpIDwgYS5sZW5ndGg7IGkrKykge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSB7XG4gICAgICBtYXRjaCA9IGZhbHNlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG1hdGNoO1xufVxuXG4vKiFcbiAqIEV4dGVuc2lvbiB0byBgaXRlcmFibGVFcXVhbGAgc3BlY2lmaWNhbGx5XG4gKiBmb3IgTm9kZS5qcyBCdWZmZXJzLlxuICpcbiAqIEBwYXJhbSB7QnVmZmVyfSBhXG4gKiBAcGFyYW0ge01peGVkfSBiXG4gKiBAcmV0dXJuIHtCb29sZWFufSByZXN1bHRcbiAqL1xuXG5mdW5jdGlvbiBidWZmZXJFcXVhbChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBpdGVyYWJsZUVxdWFsKGEsIGIpO1xufVxuXG4vKiFcbiAqIEJsb2NrIGZvciBgb2JqZWN0RXF1YWxgIGVuc3VyaW5nIG5vbi1leGlzdGluZ1xuICogdmFsdWVzIGRvbid0IGdldCBpbi5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSBvYmplY3RcbiAqIEByZXR1cm4ge0Jvb2xlYW59IHJlc3VsdFxuICovXG5cbmZ1bmN0aW9uIGlzVmFsdWUoYSkge1xuICByZXR1cm4gYSAhPT0gbnVsbCAmJiBhICE9PSB1bmRlZmluZWQ7XG59XG5cbi8qIVxuICogUmVjdXJzaXZlbHkgY2hlY2sgdGhlIGVxdWFsaXR5IG9mIHR3byBvYmplY3RzLlxuICogT25jZSBiYXNpYyBzYW1lbmVzcyBoYXMgYmVlbiBlc3RhYmxpc2hlZCBpdCB3aWxsXG4gKiBkZWZlciB0byBgZGVlcEVxdWFsYCBmb3IgZWFjaCBlbnVtZXJhYmxlIGtleVxuICogaW4gdGhlIG9iamVjdC5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSBhXG4gKiBAcGFyYW0ge01peGVkfSBiXG4gKiBAcmV0dXJuIHtCb29sZWFufSByZXN1bHRcbiAqL1xuXG5mdW5jdGlvbiBvYmplY3RFcXVhbChhLCBiLCBtKSB7XG4gIGlmICghaXNWYWx1ZShhKSB8fCAhaXNWYWx1ZShiKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICB2YXIgaTtcbiAgaWYgKG0pIHtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbS5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKChtW2ldWzBdID09PSBhICYmIG1baV1bMV0gPT09IGIpXG4gICAgICB8fCAgKG1baV1bMF0gPT09IGIgJiYgbVtpXVsxXSA9PT0gYSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIG0gPSBbXTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgdmFyIGthID0gZW51bWVyYWJsZShhKTtcbiAgICB2YXIga2IgPSBlbnVtZXJhYmxlKGIpO1xuICB9IGNhdGNoIChleCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGthLnNvcnQoKTtcbiAga2Iuc29ydCgpO1xuXG4gIGlmICghaXRlcmFibGVFcXVhbChrYSwga2IpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgbS5wdXNoKFsgYSwgYiBdKTtcblxuICB2YXIga2V5O1xuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldLCBtKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2xpYi90eXBlJyk7XG4iLCIvKiFcbiAqIHR5cGUtZGV0ZWN0XG4gKiBDb3B5cmlnaHQoYykgMjAxMyBqYWtlIGx1ZXIgPGpha2VAYWxvZ2ljYWxwYXJhZG94LmNvbT5cbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qIVxuICogUHJpbWFyeSBFeHBvcnRzXG4gKi9cblxudmFyIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IGdldFR5cGU7XG5cbi8qIVxuICogRGV0ZWN0YWJsZSBqYXZhc2NyaXB0IG5hdGl2ZXNcbiAqL1xuXG52YXIgbmF0aXZlcyA9IHtcbiAgICAnW29iamVjdCBBcnJheV0nOiAnYXJyYXknXG4gICwgJ1tvYmplY3QgUmVnRXhwXSc6ICdyZWdleHAnXG4gICwgJ1tvYmplY3QgRnVuY3Rpb25dJzogJ2Z1bmN0aW9uJ1xuICAsICdbb2JqZWN0IEFyZ3VtZW50c10nOiAnYXJndW1lbnRzJ1xuICAsICdbb2JqZWN0IERhdGVdJzogJ2RhdGUnXG59O1xuXG4vKipcbiAqICMjIyB0eXBlT2YgKG9iailcbiAqXG4gKiBVc2Ugc2V2ZXJhbCBkaWZmZXJlbnQgdGVjaG5pcXVlcyB0byBkZXRlcm1pbmVcbiAqIHRoZSB0eXBlIG9mIG9iamVjdCBiZWluZyB0ZXN0ZWQuXG4gKlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IG9iamVjdFxuICogQHJldHVybiB7U3RyaW5nfSBvYmplY3QgdHlwZVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBnZXRUeXBlIChvYmopIHtcbiAgdmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopO1xuICBpZiAobmF0aXZlc1tzdHJdKSByZXR1cm4gbmF0aXZlc1tzdHJdO1xuICBpZiAob2JqID09PSBudWxsKSByZXR1cm4gJ251bGwnO1xuICBpZiAob2JqID09PSB1bmRlZmluZWQpIHJldHVybiAndW5kZWZpbmVkJztcbiAgaWYgKG9iaiA9PT0gT2JqZWN0KG9iaikpIHJldHVybiAnb2JqZWN0JztcbiAgcmV0dXJuIHR5cGVvZiBvYmo7XG59XG5cbmV4cG9ydHMuTGlicmFyeSA9IExpYnJhcnk7XG5cbi8qKlxuICogIyMjIExpYnJhcnlcbiAqXG4gKiBDcmVhdGUgYSByZXBvc2l0b3J5IGZvciBjdXN0b20gdHlwZSBkZXRlY3Rpb24uXG4gKlxuICogYGBganNcbiAqIHZhciBsaWIgPSBuZXcgdHlwZS5MaWJyYXJ5O1xuICogYGBgXG4gKlxuICovXG5cbmZ1bmN0aW9uIExpYnJhcnkgKCkge1xuICB0aGlzLnRlc3RzID0ge307XG59XG5cbi8qKlxuICogIyMjIyAub2YgKG9iailcbiAqXG4gKiBFeHBvc2UgcmVwbGFjZW1lbnQgYHR5cGVvZmAgZGV0ZWN0aW9uIHRvIHRoZSBsaWJyYXJ5LlxuICpcbiAqIGBgYGpzXG4gKiBpZiAoJ3N0cmluZycgPT09IGxpYi5vZignaGVsbG8gd29ybGQnKSkge1xuICogICAvLyAuLi5cbiAqIH1cbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IG9iamVjdCB0byB0ZXN0XG4gKiBAcmV0dXJuIHtTdHJpbmd9IHR5cGVcbiAqL1xuXG5MaWJyYXJ5LnByb3RvdHlwZS5vZiA9IGdldFR5cGU7XG5cbi8qKlxuICogIyMjIyAuZGVmaW5lICh0eXBlLCB0ZXN0KVxuICpcbiAqIEFkZCBhIHRlc3QgdG8gZm9yIHRoZSBgLnRlc3QoKWAgYXNzZXJ0aW9uLlxuICpcbiAqIENhbiBiZSBkZWZpbmVkIGFzIGEgcmVndWxhciBleHByZXNzaW9uOlxuICpcbiAqIGBgYGpzXG4gKiBsaWIuZGVmaW5lKCdpbnQnLCAvXlswLTldKyQvKTtcbiAqIGBgYFxuICpcbiAqIC4uLiBvciBhcyBhIGZ1bmN0aW9uOlxuICpcbiAqIGBgYGpzXG4gKiBsaWIuZGVmaW5lKCdibG4nLCBmdW5jdGlvbiAob2JqKSB7XG4gKiAgIGlmICgnYm9vbGVhbicgPT09IGxpYi5vZihvYmopKSByZXR1cm4gdHJ1ZTtcbiAqICAgdmFyIGJsbnMgPSBbICd5ZXMnLCAnbm8nLCAndHJ1ZScsICdmYWxzZScsIDEsIDAgXTtcbiAqICAgaWYgKCdzdHJpbmcnID09PSBsaWIub2Yob2JqKSkgb2JqID0gb2JqLnRvTG93ZXJDYXNlKCk7XG4gKiAgIHJldHVybiAhISB+Ymxucy5pbmRleE9mKG9iaik7XG4gKiB9KTtcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlXG4gKiBAcGFyYW0ge1JlZ0V4cHxGdW5jdGlvbn0gdGVzdFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5MaWJyYXJ5LnByb3RvdHlwZS5kZWZpbmUgPSBmdW5jdGlvbiAodHlwZSwgdGVzdCkge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHRoaXMudGVzdHNbdHlwZV07XG4gIHRoaXMudGVzdHNbdHlwZV0gPSB0ZXN0O1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogIyMjIyAudGVzdCAob2JqLCB0ZXN0KVxuICpcbiAqIEFzc2VydCB0aGF0IGFuIG9iamVjdCBpcyBvZiB0eXBlLiBXaWxsIGZpcnN0XG4gKiBjaGVjayBuYXRpdmVzLCBhbmQgaWYgdGhhdCBkb2VzIG5vdCBwYXNzIGl0IHdpbGxcbiAqIHVzZSB0aGUgdXNlciBkZWZpbmVkIGN1c3RvbSB0ZXN0cy5cbiAqXG4gKiBgYGBqc1xuICogYXNzZXJ0KGxpYi50ZXN0KCcxJywgJ2ludCcpKTtcbiAqIGFzc2VydChsaWIudGVzdCgneWVzJywgJ2JsbicpKTtcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IG9iamVjdFxuICogQHBhcmFtIHtTdHJpbmd9IHR5cGVcbiAqIEByZXR1cm4ge0Jvb2xlYW59IHJlc3VsdFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5MaWJyYXJ5LnByb3RvdHlwZS50ZXN0ID0gZnVuY3Rpb24gKG9iaiwgdHlwZSkge1xuICBpZiAodHlwZSA9PT0gZ2V0VHlwZShvYmopKSByZXR1cm4gdHJ1ZTtcbiAgdmFyIHRlc3QgPSB0aGlzLnRlc3RzW3R5cGVdO1xuXG4gIGlmICh0ZXN0ICYmICdyZWdleHAnID09PSBnZXRUeXBlKHRlc3QpKSB7XG4gICAgcmV0dXJuIHRlc3QudGVzdChvYmopO1xuICB9IGVsc2UgaWYgKHRlc3QgJiYgJ2Z1bmN0aW9uJyA9PT0gZ2V0VHlwZSh0ZXN0KSkge1xuICAgIHJldHVybiB0ZXN0KG9iaik7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFJlZmVyZW5jZUVycm9yKCdUeXBlIHRlc3QgXCInICsgdHlwZSArICdcIiBub3QgZGVmaW5lZCBvciBpbnZhbGlkLicpO1xuICB9XG59O1xuIiwidmFyIGV4cGVjdCA9IHJlcXVpcmUoJ2NoYWknKS5leHBlY3Q7XG5cbmRlc2NyaWJlKCd0ZXN0IHNldHVwJywgZnVuY3Rpb24oKSB7XG5cdGl0KCdzaG91bGQgd29yaycsIGZ1bmN0aW9uKCkge1xuXHRcdGV4cGVjdCh0cnVlKS50by5iZS50cnVlO1xuXHR9KTtcblx0aXQoJ3Nob3VsZCB3b3JrIGFnYWluJywgZnVuY3Rpb24oKSB7XG5cdFx0ZXhwZWN0KHRydWUpLnRvLmJlLnRydWU7XG5cdH0pO1xufSk7Il19
