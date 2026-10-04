"""Development-only real CPU vision inference; no remote model code/network."""
import os
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
import io,base64,time,pathlib,threading
import torch
from PIL import Image
from transformers import AutoProcessor,AutoModelForVision2Seq
ROOT=pathlib.Path(__file__).parent
MODEL='HuggingFaceTB/SmolVLM-256M-Instruct'
REVISION='7e3e67edbbed1bf9888184d9df282b700a323964'
class Engine:
 def __init__(self):
  torch.set_num_threads(4);torch.set_num_interop_threads(1)
  start=time.monotonic()
  self.processor=AutoProcessor.from_pretrained(ROOT/'model',local_files_only=True,trust_remote_code=False,do_image_splitting=False,size={'longest_edge':512})
  self.model=AutoModelForVision2Seq.from_pretrained(ROOT/'model',local_files_only=True,trust_remote_code=False,torch_dtype=torch.float32,attn_implementation='sdpa').eval()
  self.lock=threading.Lock();self.load_seconds=time.monotonic()-start
 def infer(self,messages,max_tokens=128):
  images=[];chat=[]
  for message in messages:
   content=message.get('content',[])
   if isinstance(content,str):content=[{'type':'text','text':content}]
   blocks=[]
   for item in content:
    if item['type']=='text':blocks.append({'type':'text','text':item['text']})
    elif item['type']=='image_url':
     url=item['image_url']['url']
     if not url.startswith('data:image/png;base64,'):raise ValueError('Only inline synthetic PNG data is supported by this development harness.')
     data=base64.b64decode(url.partition(',')[2],validate=True)
     if len(data)>2*1024*1024:raise ValueError('Image is too large')
     image=Image.open(io.BytesIO(data))
     if image.width*image.height>16000000:raise ValueError('Image dimensions are too large')
     images.append(image.convert('RGB'));blocks.append({'type':'image'})
    else:raise ValueError('Unsupported content block')
   chat.append({'role':message['role'],'content':blocks})
  if len(images)!=1:raise ValueError('Exactly one image is supported by this harness')
  with self.lock,torch.inference_mode():
   prompt=self.processor.apply_chat_template(chat,add_generation_prompt=True)
   inputs=self.processor(text=prompt,images=images,return_tensors='pt')
   start=time.monotonic()
   generated=self.model.generate(**inputs,max_new_tokens=min(max(int(max_tokens),1),160),do_sample=False)
   output=generated[:,inputs['input_ids'].shape[1]:]
   text=self.processor.batch_decode(output,skip_special_tokens=True)[0]
   return {'text':text,'seconds':time.monotonic()-start,'prompt_tokens':inputs['input_ids'].shape[1],'completion_tokens':output.shape[1],'pixel_values_shape':list(inputs['pixel_values'].shape)}
