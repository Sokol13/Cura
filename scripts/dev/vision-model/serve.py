"""Temporary localhost OpenAI-style API over the genuine CPU model."""
import argparse,json,time,uuid,threading,traceback
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from engine import Engine,MODEL,REVISION
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8898);args=parser.parse_args()
engine=Engine();slot=threading.BoundedSemaphore(1)
class Handler(BaseHTTPRequestHandler):
 def send_json(self,status,value):
  data=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_GET(self):
  if self.path=='/health':return self.send_json(200,{'status':'ready','model':MODEL,'revision':REVISION,'device':'cpu'})
  if self.path=='/v1/models':return self.send_json(200,{'object':'list','data':[{'id':MODEL,'object':'model','owned_by':'local-development-probe'}]})
  self.send_json(404,{'error':{'message':'Unknown endpoint'}})
 def do_POST(self):
  if self.path!='/v1/chat/completions':return self.send_json(404,{'error':{'message':'Unknown endpoint'}})
  length=int(self.headers.get('Content-Length','0'))
  if not 0<length<=4*1024*1024:return self.send_json(413,{'error':{'message':'Bounded JSON body required'}})
  if not slot.acquire(blocking=False):return self.send_json(429,{'error':{'message':'Local CPU model is busy'}})
  try:
   request=json.loads(self.rfile.read(length))
   if request.get('stream'):raise ValueError('Streaming is not supported by this development harness')
   if request.get('model',MODEL)!=MODEL:raise ValueError('Unknown model')
   if request.get('response_format'):raise ValueError('Constrained JSON decoding is not supported; raw model text is returned')
   result=engine.infer(request['messages'],request.get('max_tokens',128))
   response={'id':'chatcmpl-'+uuid.uuid4().hex,'object':'chat.completion','created':int(time.time()),'model':MODEL,'choices':[{'index':0,'message':{'role':'assistant','content':result['text']},'finish_reason':'length' if result['completion_tokens']>=min(request.get('max_tokens',128),160) else 'stop'}],'usage':{'prompt_tokens':result['prompt_tokens'],'completion_tokens':result['completion_tokens'],'total_tokens':result['prompt_tokens']+result['completion_tokens']}}
   print(json.dumps({'event':'real-inference','seconds':result['seconds'],'raw_output':result['text']}),flush=True)
   self.send_json(200,response)
  except (ValueError,KeyError) as error:self.send_json(400,{'error':{'message':str(error)}})
  except Exception as error:
   traceback.print_exc();self.send_json(500,{'error':{'message':str(error)}})
  finally:slot.release()
print(json.dumps({'event':'ready','bind':'127.0.0.1','port':args.port,'model':MODEL,'revision':REVISION,'load_seconds':engine.load_seconds}),flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
