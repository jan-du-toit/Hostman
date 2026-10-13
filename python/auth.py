#!/usr/bin/env python3
"""System password verification. Passwords arrive only on stdin and are never stored."""
import ctypes as C
import ctypes.util
import json
import os
import sys

def linux_auth(username,password):
    import pwd
    import grp
    try: user=pwd.getpwnam(username)
    except KeyError: return False
    groups={grp.getgrgid(g).gr_name for g in os.getgrouplist(user.pw_name,user.pw_gid)}
    if user.pw_uid!=0 and not groups.intersection({'wheel','sudo'}): return False
    class Message(C.Structure): _fields_=[('style',C.c_int),('msg',C.c_char_p)]
    class Response(C.Structure): _fields_=[('resp',C.c_void_p),('code',C.c_int)]
    ConvFn=C.CFUNCTYPE(C.c_int,C.c_int,C.POINTER(C.POINTER(Message)),C.POINTER(C.POINTER(Response)),C.c_void_p)
    class Conversation(C.Structure): _fields_=[('conv',ConvFn),('data',C.c_void_p)]
    libc=C.CDLL(ctypes.util.find_library('c'))
    libc.calloc.argtypes=[C.c_size_t,C.c_size_t];libc.calloc.restype=C.c_void_p
    libc.strdup.argtypes=[C.c_char_p];libc.strdup.restype=C.c_void_p
    libc.free.argtypes=[C.c_void_p]
    @ConvFn
    def converse(n,messages,responses,data):
        if n<1 or n>32:return 19
        block=libc.calloc(n,C.sizeof(Response))
        if not block:return 19
        array=C.cast(block,C.POINTER(Response))
        allocated=[]
        for i in range(n):
            style=messages[i].contents.style
            if style in (1,2):
                value=(password if style==1 else username).encode('utf-8')
                ptr=libc.strdup(value)
                if not ptr:
                    for a in allocated:libc.free(a)
                    libc.free(block);return 19
                allocated.append(ptr);array[i].resp=ptr
            elif style not in (3,4):
                for a in allocated:libc.free(a)
                libc.free(block);return 19
        responses[0]=array
        return 0
    pam=C.CDLL(ctypes.util.find_library('pam') or 'libpam.so.0')
    pam.pam_start.argtypes=[C.c_char_p,C.c_char_p,C.POINTER(Conversation),C.POINTER(C.c_void_p)]
    for fn in ('pam_authenticate','pam_acct_mgmt','pam_end'):getattr(pam,fn).argtypes=[C.c_void_p,C.c_int]
    handle=C.c_void_p();conv=Conversation(converse,None)
    result=pam.pam_start(b'hostman',username.encode(),C.byref(conv),C.byref(handle))
    if result!=0:return False
    try:
        result=pam.pam_authenticate(handle,1)
        if result==0:result=pam.pam_acct_mgmt(handle,0)
        return result==0
    finally:pam.pam_end(handle,result)

def windows_auth(username,password):
    from ctypes import wintypes as W
    adv=C.WinDLL('advapi32',use_last_error=True);kernel=C.WinDLL('kernel32',use_last_error=True)
    adv.LogonUserW.argtypes=[W.LPCWSTR,W.LPCWSTR,W.LPCWSTR,W.DWORD,W.DWORD,C.POINTER(W.HANDLE)]
    adv.LogonUserW.restype=W.BOOL
    adv.DuplicateToken.argtypes=[W.HANDLE,C.c_int,C.POINTER(W.HANDLE)]
    adv.CheckTokenMembership.argtypes=[W.HANDLE,C.c_void_p,C.POINTER(W.BOOL)]
    adv.GetTokenInformation.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD,C.POINTER(W.DWORD)]
    adv.CreateWellKnownSid.argtypes=[C.c_int,C.c_void_p,C.c_void_p,C.POINTER(W.DWORD)]
    kernel.CloseHandle.argtypes=[W.HANDLE]
    # Local accounts, DOMAIN\\user and MicrosoftAccount\\email are accepted.
    if '\\' in username: domain,name=username.split('\\',1)
    else: domain,name='.',username
    token=W.HANDLE();duplicate=W.HANDLE()
    if not adv.LogonUserW(name,domain,password,2,0,C.byref(token)):return False
    try:
        if not adv.DuplicateToken(token,2,C.byref(duplicate)):return False
        sid=C.create_string_buffer(68);size=W.DWORD(68);member=W.BOOL()
        if not adv.CreateWellKnownSid(26,None,sid,C.byref(size)):return False
        if not adv.CheckTokenMembership(duplicate,sid,C.byref(member)):return False
        if member.value:return True
        # UAC may produce a filtered administrator token; check its linked token.
        linked=W.HANDLE();needed=W.DWORD()
        if adv.GetTokenInformation(token,19,C.byref(linked),C.sizeof(linked),C.byref(needed)):
            full=W.HANDLE()
            try:
                if adv.DuplicateToken(linked,2,C.byref(full)) and adv.CheckTokenMembership(full,sid,C.byref(member)):
                    return bool(member.value)
            finally:
                if full:kernel.CloseHandle(full)
                if linked:kernel.CloseHandle(linked)
        return False
    finally:
        if duplicate:kernel.CloseHandle(duplicate)
        kernel.CloseHandle(token)

def authenticate(username,password):
    if not isinstance(username,str) or not isinstance(password,str) or not username or not password:
        return False
    if len(username)>256 or len(password)>1024 or '\0' in username+password:return False
    return windows_auth(username,password) if os.name=='nt' else linux_auth(username,password)

if __name__=='__main__':
    try:
        request=json.load(sys.stdin)
        ok=authenticate(request.get('username'),request.get('password'))
        print(json.dumps({'ok':ok,'user':request.get('username') if ok else None}))
    except Exception:
        print(json.dumps({'ok':False,'user':None}))
        sys.exit(1)
