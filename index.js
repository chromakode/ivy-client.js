var inherits = require('inherits')
var EventEmitter = require('events')


var Ivy = module.exports = function Ivy(url) {
  this.url = url
  this._nextAckKey = 0
  this._pendingAcks = {}
  // FIXME: wss?
  this.s = new WebSocket('ws:' + url + '/ws', 'ivy1')
  this.s.onopen = this.onReady.bind(this)
  this.s.onclose = this.onClose.bind(this)
  this.s.onmessage = this.onMessage.bind(this)
  window.addEventListener('beforeunload', function() {
    this.s.close()
  }.bind(this), false)
}

inherits(Ivy, EventEmitter)

Ivy.prototype.onReady = function(ev) {
  this.emit('ready', ev)
}

Ivy.prototype.onClose = function(ev) {
  this.emit('close', ev)
}

Ivy.prototype._ackCallback = function(ackKey, data) {
  if (!ackKey) {
    return
  }

  if (this._pendingAcks.hasOwnProperty(ackKey)) {
    this._pendingAcks[ackKey](data)
    delete this._pendingAcks[ackKey]
  }
}

Ivy.prototype._handleMessage = function(data) {
  var ackKey
  if (data[0] == '#') {
    var ackEnd = data.indexOf('#', 1)
    if (ackEnd == -1) {
      throw 'invalid ack message: ' + data
    }
    ackKey = data.substr(1, ackEnd - 1)
    data = data.substr(ackEnd + 1)
  }

  var ts
  if (data[0] == '@') {
    var tsEnd = data.indexOf(':', 1)
    if (tsEnd == -1) {
      tsEnd = data.length
    }
    ts = Number(data.substr(1, tsEnd))
    data = data.substr(tsEnd)
  } else {
    throw 'invalid message: ' + data
  }

  switch (data[0]) {
    case undefined:
      this._ackCallback(ackKey, ts)
      this.emit('timestamp', ts)
      break
    case ':':
      var parts = data.split(':')
      var path = parts[1]
      var data = decodeURIComponent(parts.slice(2).join(':'))
      this._ackCallback(ackKey, data)
      this.emit('msg', path, data, ts)
      var slashIdx
      var pathPart = path
      while ((slashIdx = pathPart.lastIndexOf('/')) != -1) {
        this.emit(pathPart, path, data)
        pathPart = pathPart.substr(0, slashIdx)
      }
      break
    default:
      throw 'invalid message: ' + data
  }
}

Ivy.prototype.onMessage = function(ev) {
  this._handleMessage(ev.data)
}

Ivy.prototype.subscribe = function(path) {
  this.s.send('+' + path)
}

Ivy.prototype.unsubscribe = function(path) {
  this.s.send('-' + path)
}

Ivy.prototype._send = function(msg, callback) {
  if (callback) {
    this._pendingAcks[this._nextAckKey] = callback
    msg = '#' + this._nextAckKey + '#' + msg
    this._nextAckKey++
  }
  this.s.send(msg)
}

Ivy.prototype.send = function(path, data, callback) {
  var msg = ':' + path + ':' + data
  this._send(msg, callback)
}

Ivy.prototype.getTimestamp = function(callback) {
  this._send('@', callback)
}

Ivy.prototype.load = function(path, options) {
  options = options || {}
  var req = new XMLHttpRequest()
  req.onload = this._onLog.bind(this)

  params = []
  if (options.count) {
    params.push('n=' + options.count)
  }
  if (options.at) {
    params.push('at=' + options.at)
  }

  var paramString = ''
  if (params) {
    paramString = '?' + params.join('&')
  }

  // FIXME: https?
  var url = 'http://' + this.url + '/events' + path + paramString
  req.open('get', url, true)
  req.send()
}

Ivy.prototype._onLog = function(ev) {
  var lines = ev.target.responseText.split('\n')
  var idx = 0
  var handle = this._handleMessage.bind(this)
  function read() {
    var start = Date.now()
    for (var i = idx; i < lines.length; i++) {
      if (Date.now() - start >= 3) {
        break
      }

      if (!lines[i]) {
        continue
      }
      handle(lines[i])
    }
    idx = i

    if (i < lines.length) {
      setTimeout(read, 0)
    }
  }
  read()
}
