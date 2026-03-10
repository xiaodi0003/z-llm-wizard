import { QueuedRequest, ChatCompletionRequest } from '../types';

// Fields to remove from SSE responses to hide internal implementation details
const FIELDS_TO_REMOVE = [
  'sp_v2',           // Suggestions
  'has_suggest',     // Has suggestions flag
  'tea_tags_time_cost',
  'agent_intention',
  'agent_id',
  'agent_name',
  'agent_hub_model_family_name',
  'llm_intention',
  'llm_intention_detail',
  'z_intervene_id',
  'z_intervene_result',
  'z_intention_result',
  'z_is_jinnang_next_n_round',
  'inner_log_id',
  'inner_app_id',
  'inner_region',
  'inner_platform',
  'inner_user_ip',
  'inner_bot_id',
  'bot_state',
  'bot_source',
  'bot_id',
  'chat_ability',
  'chat_id',
  'chat_next',
  'client_report_scene',
  'cot_switch',
  'detailed_model_name',
  'model_type',
  'model_id',
  'llm_model_type',
  'update_version_code',
  'review_scenario_id',
  'msg_scene',
  'tts',
  'use_content_block',
  'use_deep_think',
  'search_engine_type',
  'section_tag_1h',
  'seed_intention',
  'is_pro',
  'before_content_type',
  'attachment_scene',
  'input_skill',
  'reply_unique_key',
  'fp',
  'ugc_voice_id',
  'group',
  'speaker_id',
  'commerce_credit_config_enable',
  'is_ai_playground',
  'sub_conv_firstmet_type',
  'pre_read_conv_version',
  'read_conv_version',
  'biz_content_type',
  'sec_sender',
  'fetch_token',
  'local_message_id',
  'local_conversation_id',
  'bot_reply_message_id'
];

function filterSSEData(data: string): string {
  try {
    const obj = JSON.parse(data);
    return JSON.stringify(filterObject(obj));
  } catch (error) {
    // If not JSON, return as-is
    return data;
  }
}

function filterObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => filterObject(item));
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const filtered: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      // Skip fields in the removal list
      if (FIELDS_TO_REMOVE.includes(key)) {
        continue;
      }

      const value = obj[key];
      
      // Recursively filter nested objects
      if (typeof value === 'object' && value !== null) {
        filtered[key] = filterObject(value);
      } else {
        filtered[key] = value;
      }
    }
  }

  return filtered;
}

export class RequestQueue {
  private queue: Map<string, QueuedRequest> = new Map();
  private requestCounter = 0;
  private readonly TIMEOUT = 30000; // 30 seconds

  public addRequest(request: ChatCompletionRequest): string {
    const id = this.generateRequestId();
    const queuedRequest: QueuedRequest = {
      id,
      request,
      createdAt: Date.now(),
    };
    this.queue.set(id, queuedRequest);

    // Setup timeout
    setTimeout(() => {
      if (this.queue.has(id)) {
        const req = this.queue.get(id)!;
        if (req.errorCallback) {
          req.errorCallback('Request timeout');
        }
        this.queue.delete(id);
      }
    }, this.TIMEOUT);

    return id;
  }

  public getRequest(id: string): QueuedRequest | undefined {
    return this.queue.get(id);
  }

  public setResponseCallback(id: string, callback: (data: string) => void) {
    const req = this.queue.get(id);
    if (req) {
      req.responseCallback = callback;
    }
  }

  public setErrorCallback(id: string, callback: (error: string) => void) {
    const req = this.queue.get(id);
    if (req) {
      req.errorCallback = callback;
    }
  }

  public setCompleteCallback(id: string, callback: () => void) {
    const req = this.queue.get(id);
    if (req) {
      req.completeCallback = callback;
    }
  }

  public handleSSEData(id: string, data: string) {
    console.log(`[Queue] handleSSEData called for ${id}`);
    const req = this.queue.get(id);
    if (req) {
      console.log(`[Queue] Request found, responseCallback exists: ${!!req.responseCallback}`);
      if (req.responseCallback) {
        console.log(`[Queue] Calling responseCallback`);
        // Filter sensitive fields from raw Douyin data before conversion
        const filteredData = filterSSEData(data);
        req.responseCallback(filteredData);
      } else {
        console.log(`[Queue] No responseCallback set for ${id}`);
      }
    } else {
      console.log(`[Queue] Request not found for ${id}`);
    }
  }

  public handleError(id: string, error: string) {
    const req = this.queue.get(id);
    if (req && req.errorCallback) {
      req.errorCallback(error);
    }
    this.queue.delete(id);
  }

  public handleComplete(id: string) {
    console.log(`[Queue] handleComplete called for ${id}`);
    const req = this.queue.get(id);
    if (req) {
      console.log(`[Queue] Request found, calling completeCallback`);
      if (req.completeCallback) {
        console.log(`[Queue] Callback exists, executing...`);
        req.completeCallback();
      } else {
        console.log(`[Queue] No completeCallback set for ${id}`);
      }
    } else {
      console.log(`[Queue] Request not found for ${id}`);
    }
    this.queue.delete(id);
  }

  public removeRequest(id: string) {
    this.queue.delete(id);
  }

  private generateRequestId(): string {
    return `req-${++this.requestCounter}-${Date.now()}`;
  }

  public getQueueSize(): number {
    return this.queue.size;
  }
}
