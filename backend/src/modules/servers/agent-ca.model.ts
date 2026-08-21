import { Document, model, Schema } from 'mongoose';

const agentCaSchema = new Schema(
  {
    caCertPem: { type: String, required: true },
    caKeyPem: { type: String, required: true, select: false },
    clientCertPem: { type: String, required: true },
    clientKeyPem: { type: String, required: true, select: false },
  },
  { versionKey: false, timestamps: true },
);

export default model('agent_ca', agentCaSchema) as unknown as import('mongoose').Model<
  AgentCa & Document
>;
