import { Document, model, Schema } from 'mongoose';
import { GIT_HOSTS } from '../../providers/git/git.contract';
import { paginateStatics } from '../../utils/pagination';
import {
  APPLICATION_GIT_SOURCES,
  APPLICATION_RESTART_POLICIES,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
} from './application.schema';

const variableSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    value: { type: String, required: true, select: false },
    secret: { type: Boolean, required: true, default: false },
    build: { type: Boolean, required: true, default: false },
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

const portMappingSchema = new Schema(
  {
    hostPort: { type: Number, required: true },
    containerPort: { type: Number, required: true },
    protocol: { type: String, required: true, enum: ['tcp', 'udp'], default: 'tcp' },
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
    source: { type: String, required: true, enum: APPLICATION_SOURCES, default: 'git' },
    git: {
      host: { type: String, required: true, enum: GIT_HOSTS, default: 'github' },
      repository: { type: String, trim: true },
      branch: { type: String, required: true, trim: true, default: 'main' },
      dockerfilePath: { type: String, required: true, trim: true, default: 'Dockerfile' },
      buildContext: { type: String, required: true, trim: true, default: '.' },
      autoDeploy: { type: Boolean, required: true, default: true },
      token: { type: String, select: false },
      hasToken: { type: Boolean, required: true, default: false },
      webhookId: { type: String },
      webhookSecret: { type: String, select: false },
      source: { type: String, required: true, enum: APPLICATION_GIT_SOURCES, default: 'pat' },
      gitSourceId: { type: Schema.Types.ObjectId, ref: 'git_sources' },
      installationId: { type: String },
    },
    compose: {
      content: { type: String },
      expose: {
        service: { type: String, trim: true },
        port: { type: Number },
        kind: { type: String, enum: ['http', 'tcp', 'udp'], default: 'http' },
        startupTimeoutSeconds: { type: Number },
      },
      console: {
        logFile: { type: String, trim: true },
        tailLines: { type: Number },
      },
    },
    origin: {
      templateId: { type: String, trim: true },
      templateVersion: { type: Number },
      inputs: { type: Schema.Types.Mixed },
      composeHash: { type: String },
    },
    port: { type: Number },
    portMappings: { type: [portMappingSchema], default: [] },
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
    autoDomainDisabled: { type: Boolean, required: true, default: false },
  },
  {
    versionKey: false,
    timestamps: true,
    statics: paginateStatics,
  },
);

applicationSchema.index({ environmentId: 1, slug: 1 }, { unique: true });

export default model('applications', applicationSchema) as unknown as PaginateModel<
  Application & Document
>;
