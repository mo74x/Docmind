/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { of } from 'rxjs';
import { Response } from 'express';

import { ThrottlerGuard } from '@nestjs/throttler';

describe('ChatController', () => {
  let controller: ChatController;
  let chatServiceMock: {
    createSession: jest.Mock;
    listSessions: jest.Mock;
    getSessionWithMessages: jest.Mock;
    deleteSession: jest.Mock;
    sendMessage: jest.Mock;
    sendMessageStream: jest.Mock;
  };

  beforeEach(async () => {
    chatServiceMock = {
      createSession: jest.fn(),
      listSessions: jest.fn(),
      getSessionWithMessages: jest.fn(),
      deleteSession: jest.fn(),
      sendMessage: jest.fn(),
      sendMessageStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: chatServiceMock,
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('should create a session', async () => {
    const mockSession = { id: 'sess-1', title: 'New Chat' };
    chatServiceMock.createSession.mockResolvedValue(mockSession);

    const result = await controller.createSession({ title: 'New Chat' });
    expect(chatServiceMock.createSession).toHaveBeenCalledWith({
      title: 'New Chat',
    });
    expect(result).toEqual(mockSession);
  });

  it('should list sessions', async () => {
    const mockList = { data: [{ id: 'sess-1' }], meta: { totalItems: 1 } };
    chatServiceMock.listSessions.mockResolvedValue(mockList);

    const result = await controller.listSessions({
      page: 1,
      limit: 10,
      order: 'DESC',
    });
    expect(chatServiceMock.listSessions).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      order: 'DESC',
    });
    expect(result).toEqual(mockList);
  });

  it('should get session with messages', async () => {
    const mockSession = { id: 'sess-1', messages: [] };
    chatServiceMock.getSessionWithMessages.mockResolvedValue(mockSession);

    const result = await controller.getSession('sess-1');
    expect(chatServiceMock.getSessionWithMessages).toHaveBeenCalledWith(
      'sess-1',
    );
    expect(result).toEqual(mockSession);
  });

  it('should delete a session', async () => {
    chatServiceMock.deleteSession.mockResolvedValue(undefined);

    const result = await controller.deleteSession('sess-1');
    expect(chatServiceMock.deleteSession).toHaveBeenCalledWith('sess-1');
    expect(result).toEqual({
      message: 'Chat session deleted successfully',
      id: 'sess-1',
    });
  });

  it('should send a message', async () => {
    const mockResponse = {
      sessionId: 'sess-1',
      userMessage: { id: 'u1', content: 'hello' },
      assistantMessage: { id: 'a1', content: 'hi' },
      sources: [],
      standaloneQuery: 'hello',
    };
    chatServiceMock.sendMessage.mockResolvedValue(mockResponse);

    const result = await controller.sendMessage('sess-1', { content: 'hello' });
    expect(chatServiceMock.sendMessage).toHaveBeenCalledWith('sess-1', {
      content: 'hello',
    });
    expect(result).toEqual(mockResponse);
  });

  it('should stream message via GET SSE endpoint', (done) => {
    const mockEvents = [
      { data: { type: 'sources', data: [], standaloneQuery: 'hello' } },
      { data: { type: 'token', content: 'hello' } },
      { data: { type: 'done', messageId: 'm1' } },
    ];
    chatServiceMock.sendMessageStream.mockReturnValue(of(...mockEvents));

    const observable = controller.sendMessageStreamGet('sess-1', {
      content: 'hello',
    });
    const collected: any[] = [];
    observable.subscribe({
      next: (val) => collected.push(val),
      complete: () => {
        expect(collected).toHaveLength(3);
        done();
      },
    });
  });

  it('should stream message via POST SSE endpoint', () => {
    const mockEvents = [
      { data: { type: 'sources', data: [] } },
      { data: { type: 'token', content: 'word' } },
      { data: { type: 'done', messageId: 'm1' } },
    ];
    chatServiceMock.sendMessageStream.mockReturnValue(of(...mockEvents));

    const resMock = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as unknown as Response;

    controller.sendMessageStreamPost('sess-1', { content: 'query' }, resMock);

    expect(resMock.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );
    expect(resMock.write).toHaveBeenCalledTimes(3);
    expect(resMock.end).toHaveBeenCalled();
  });
});
