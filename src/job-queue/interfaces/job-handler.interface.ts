export interface IJobHandler<TPayload = unknown, TOutput = unknown> {
  readonly jobType: string;
  handle(payload: TPayload, jobId: bigint): Promise<TOutput | void>;
}
