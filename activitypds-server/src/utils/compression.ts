import compression from "compression";
import express from "express";

export default function () {
  return compression({
    filter: (req: express.Request, res: express.Response) => {
      return false;
    },
  }) as express.RequestHandler;
}
