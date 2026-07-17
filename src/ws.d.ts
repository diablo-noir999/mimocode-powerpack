declare module "ws" {
  import { EventEmitter } from "events"
  import { Server as HttpServer } from "http"

  class WebSocket extends EventEmitter {
    constructor(url: string | URL, options?: any)
    send(data: string | Buffer): void
    close(): void
    readyState: number
  }

  class WebSocketServer extends EventEmitter {
    constructor(options: { port?: number; server?: HttpServer })
    on(event: "connection", listener: (ws: WebSocket) => void): this
    clients: Set<WebSocket>
    close(): void
  }

  export { WebSocket, WebSocketServer }
}
