'use strict'

const spawnNode = require('./spawn-libp2p-node')
const Transaction = require('ethereumjs-tx')
const rlp = require('rlp')
const EE = require('events').EventEmitter
const util = require('util')
const lp = require('pull-length-prefixed')
const pull = require('pull-stream')
const EthereumVM = require('./ethereum-vm')

exports = module.exports
exports.Node = EthereumNode

util.inherits(EthereumNode, EE)

function EthereumNode (blockchain) {
  if (!(this instanceof EthereumNode)) {
    return new EthereumNode(blockchain)
  }

  EE.call(this)

  // === vm and blockchain ===

  this.vm = EthereumVM.create(blockchain)
  this.blockchain = this.vm._blockchain

  // === libp2p ===

  this.libp2p = null

  this.start = (peerInfo, callback) => {
    if (typeof peerInfo === 'function') {
      callback = peerInfo
      peerInfo = undefined
    }
    spawnNode(peerInfo, (err, libp2pNode) => {
      if (err) {
        return callback(err)
      }
      this.libp2p = libp2pNode
      setupDiscovery(this.libp2p)
      mountTxProtocol(this, this.libp2p)
      mountBlockSyncProtocol(this, this.libp2p)
      callback()
    })
  }

  this.stop = (callback) => {
    this.libp2p.stop(callback)
  }

  function setupDiscovery (libp2pNode) {
    libp2pNode.discovery.on('peer', (peerInfo) => {
      console.log('FOUND NEW PEER')
      // TODO dial to that peer
    })
  }

  // === blocks ===

  this.block = {}

  // TODO
  this.block.send = (peerInfo, block, callback) => {
    callback(new Error('not implemented yet'))
  }

  // TODO
  this.block.broadcast = (peerInfo, block, callback) => {
    callback(new Error('not implemented yet'))
  }

  // TODO
  this.block.sync = (peerInfo, callback) => {
    callback(new Error('not implemented yet'))
  }

  function mountBlockSyncProtocol (ethereumNode, libp2pNode) {
    // Receive blocks
    libp2pNode.handle('/eth/block/sync/1.0.0', (conn) => {
      pull(
        conn,
        lp.decode(),
        pull.drain((blockRlpEncoded) => {
          // TODO treat the blocks
          console.log('got block')
        }),
        pull.onEnd((err) => {
          if (err) {
            return console.log('block proto err:', err)
          }
        })
      )
    })
  }

  // === transactions ===

  this.tx = {}

  this.setPrivateKey = (privateKey) => {
    this.ethPrivKey = privateKey
  }

  this.tx.send = (peerInfo, tx, callback) => {
    tx.sign(this.ethPrivKey)

    this.libp2p.dialByPeerInfo(peerInfo, '/eth/tx/1.0.0', gotConn)

    function gotConn (err, conn) {
      if (err) {
        return callback(err)
      }

      pull(
        pull.values([
          tx.serialize()
        ]),
        lp.encode(),
        conn
      )

      callback()
    }
  }

  // TODO
  this.tx.broadcast = (tx, callback) => {
    callback(new Error('not implemented yet'))
  }

  // TODO make relay accept tx in the same protocol
  // no need to differentiate
  this.tx.relay = (peerInfo, tx, callback) => {
    tx.sign(this.ethPrivKey)

    this.libp2p.dialByPeerInfo(peerInfo, '/ethereum/tx-relay', gotConn)

    function gotConn (err, conn) {
      if (err) {
        return callback(err)
      }

      pull(
        pull.values([
          tx.serialize()
        ]),
        lp.encode(),
        conn
      )

      callback()
    }
  }

  function mountTxProtocol (ethereumNode, libp2pNode) {
    libp2pNode.handle('/eth/tx/1.0.0', (conn) => {
      pull(
        conn,
        lp.decode(),
        pull.collect((err, txs) => {
          if (err) {
            return console.log('receive tx err:', err)
          }

          txs.forEach((tx) => {
            const decoded = rlp.decode(tx)
            tx = new Transaction(decoded)
            if (tx.verifySignature()) {
              ethereumNode.emit('tx', tx)
            }
          })
        })
      )
    })
  }
}
