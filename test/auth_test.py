import sys
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'python'))
import auth

STUB=r'''
#include <stdlib.h>
#include <string.h>
struct msg {int style;const char *text;};
struct resp {char *text;int code;};
struct conv {int (*fn)(int,const struct msg **,struct resp **,void *);void *data;};
static struct conv active;
int pam_start(const char *service,const char *user,const struct conv *c,void **handle){active=*c;*handle=(void*)1;return strcmp(service,"hostman");}
int pam_authenticate(void *handle,int flags){
 struct msg m={1,"Password:"};const struct msg *pm=&m;struct resp *out=0;
 int code=active.fn(1,&pm,&out,active.data);if(code)return code;
 int ok=out && out[0].text && !strcmp(out[0].text,"test-password");
 if(out){free(out[0].text);free(out);}return ok?0:7;
}
int pam_acct_mgmt(void *handle,int flags){return 0;}
int pam_end(void *handle,int code){return 0;}
'''
class Authentication(unittest.TestCase):
    def test_empty_and_invalid(self):
        for name,password in [('', 'pw'),('root',''),(None,'pw'),('root','bad\0pw')]:self.assertFalse(auth.authenticate(name,password))
    @unittest.skipUnless(shutil.which("gcc"),"gcc is required for the native PAM ABI test")
    def test_native_pam_conversation(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'pam.c';library=Path(folder)/'pam.so';source.write_text(STUB)
            subprocess.run(['gcc','-shared','-fPIC',str(source),'-o',str(library)],check=True)
            original=auth.ctypes.util.find_library
            with patch.object(auth.ctypes.util,'find_library',side_effect=lambda name:str(library) if name=='pam' else original(name)):
                self.assertTrue(auth.linux_auth('root','test-password'))
                self.assertFalse(auth.linux_auth('root','incorrect'))
if __name__=='__main__':unittest.main()
