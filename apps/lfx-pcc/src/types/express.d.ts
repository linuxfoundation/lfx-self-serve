declare global {
  namespace Express {
    interface Request {
      bearerToken?: string;
    }
  }
}

export {};
