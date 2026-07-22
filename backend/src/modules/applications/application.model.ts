import { Document, model, Schema } from 'mongoose';
import { GIT_HOSTS } from '../../providers/git/git.contract';
import { paginateStatics } from '../../utils/pagination';
import { APPLICATION_RESTART_POLICIES, APPLICATION_STATUSES } from './application.schema';

const variableSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    // Encrypted, never hashed: the platform has to inject the value into the container.
    value: { type: String, required: true, select: false },
    secret: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const volumeSchema = new Schema(
  {
    source: { type: String, required: true, trim: true },
    target: { type: String, required: true, trim: true },
    readOnly: { type: Boolean },
  },
  { _id: false },
);

const applicationSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'organizations',
      required: true,
      index: true,
    },
    projectId: { type: Schema.Types.ObjectId, ref: 'projects', required: true, index: true },
    environmentId: {
      type: Schema.Types.ObjectId,
      ref: 'environments',
      required: true,
      index: true,
    },
    serverId: { type: Schema.Types.ObjectId, ref: 'servers', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, required: true, enum: APPLICATION_STATUSES, default: 'created' },
    git: {
      host: { type: String, required: true, enum: GIT_HOSTS, default: 'github' },
      repository: { type: String, required: true, trim: true },
      branch: { type: String, required: true, trim: true, default: 'main' },
      dockerfilePath: { type: String, required: true, trim: true, default: 'Dockerfile' },
      buildContext: { type: String, required: true, trim: true, default: '.' },
      autoDeploy: { type: Boolean, required: true, default: true },
      // Encrypted and hidden; `hasToken` exists because a `select: false` field cannot be seen by
      // the reads that only need to know whether a credential is configured.
      token: { type: String, select: false },
      hasToken: { type: Boolean, required: true, default: false },
    },
    port: { type: Number, required: true },
    variables: { type: [variableSchema], default: [] },
    volumes: { type: [volumeSchema], default: [] },
    networks: { type: [String], default: [] },
    healthcheck: {
      path: { type: String, trim: true },
      intervalSeconds: { type: Number },
      timeoutSeconds: { type: Number },
      retries: { type: Number },
      startPeriodSeconds: { type: Number },
    },
    resources: {
      cpus: { type: Number },
      memoryMb: { type: Number },
    },
    restartPolicy: {
      type: String,
      required: true,
      enum: APPLICATION_RESTART_POLICIES,
      default: 'unless-stopped',
    },
    lastError: { type: String },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

// A slug identifies an application inside its environment.
applicationSchema.index({ environmentId: 1, slug: 1 }, { unique: true });

export default model('applications', applicationSchema) as unknown as PaginateModel<
  Application & Document
>;
