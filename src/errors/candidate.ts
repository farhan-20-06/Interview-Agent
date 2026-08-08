export class CandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class CandidateNotFoundError extends CandidateError {
  constructor(candidateId: string) {
    super(`Candidate not found: ${candidateId}`);
  }
}

export class CandidateDataError extends CandidateError {
  constructor(message: string) {
    super(message);
  }
}
